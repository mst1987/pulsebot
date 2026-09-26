// The client script of the log-check report pages (/r/<id>, /r/<id>/p/<n>) and
// of every other page built on report/layout.js (docs, the public event page).
// Served as /r-assets/report.js (report/assets.js) with a content hash in the
// url, so a browser caches it for good and still gets every change at once.
//
// No bundle, no framework: every part listens on `document` and acts on the
// data-* attributes the server renders, so it does not matter which of them a
// page carries. The pure helpers at the top hold the decisions (request
// bodies, labels, filters) and are exported for the Jest tests; the wiring
// below them only reads and writes the DOM.
(function () {
    // ---- pure helpers ------------------------------------------------------------

    /** The CSRF token out of a GET /api/session answer. */
    function csrfFrom(j) {
        return (j && (j.csrfToken || (j.data && j.data.csrfToken))) || "";
    }

    /** The message of a failed API answer, else the HTTP status. */
    function errorText(j, status) {
        return (j && j.error && j.error.message) || (j && j.message) || status;
    }

    /** The report id of a /r/<id>[/…] path, or undefined. */
    function reportIdOf(pathname) {
        return (String(pathname || "").match(/^\/r\/([a-zA-Z0-9]+)/) || [])[1];
    }

    var STATE_LABEL = { approved: "freigegeben", rejected: "nicht senden", open: "offen" };
    var STATE_TONE = { approved: "ok", rejected: "bad", open: "mid" };

    /** A verdict as the state word the row's classes use. */
    function reviewState(approved) {
        return approved === true ? "approved" : approved === false ? "rejected" : "open";
    }

    /**
     * The POST /api/cla/recommendations body for a verdict button. A second click
     * on the active verdict takes it back (approved: null).
     * @param {object} o { reportId, scope, player, key, action, state, text }
     */
    function reviewBody(o) {
        var body = { reportId: o.reportId, scope: o.scope, player: o.player, key: o.key };
        if (o.action === "approve") body.approved = o.state === "approved" ? null : true;
        else if (o.action === "reject") body.approved = o.state === "rejected" ? null : false;
        else if (o.action === "reset") body.approved = null;
        else if (o.action === "save") body.text = o.text;
        return body;
    }

    /** The POST /api/cla/recommendations/phrase body: one raider or the whole report. */
    function phraseBody(reportId, player) {
        return player ? { reportId: reportId, players: [player] } : { reportId: reportId };
    }

    /** The line after a finished phrasing job. */
    function phraseDoneText(last) {
        var l = last || {};
        var errors = (l.errors || []).length;
        return "Fertig: " + (l.phrased || 0) + " Texte für " + (l.players || 0) + " Raider" + (errors ? ", " + errors + " Fehler" : "") + ". Seite wird neu geladen …";
    }

    /** Whether a raider's Discord account is known, as the badge says it. */
    function mappingLabel(x) {
        return x.mapped ? "Konto zugeordnet" : x.ambiguous ? "mehrere Konten" : "kein Konto zugeordnet";
    }

    /** One line of "Zuordnung prüfen": name, approved points, mapping, last send. */
    function statusLine(x) {
        var sent = x.sentAt ? " · gesendet " + new Date(x.sentAt).toLocaleString("de-DE") + (x.changed ? " (seitdem geändert)" : "") : "";
        return x.name + ": " + x.approved + " Punkte · " + mappingLabel(x) + sent;
    }

    /** A point's text in the DM preview, cut after 160 characters. */
    function previewText(text) {
        return text.length > 160 ? text.slice(0, 160) + " …" : text;
    }

    /** What the send dialog says after "Per Bot senden"; `force` offers "Trotzdem erneut senden". */
    function sendResult(res) {
        var s = (res.sent || [])[0];
        var k = (res.skipped || [])[0];
        if (s) return { text: "Gesendet: " + s.items + " Punkte an " + s.name + ".", force: false };
        if (k) return { text: k.message || res.message || "", force: k.reason === "already_sent" };
        return { text: res.message || "Nichts gesendet.", force: false };
    }

    /**
     * Where a url points on the report page: ?player=<name> and #raider-<name>
     * open that raider's card, #raid / #bosse / #raider a view.
     * @returns {{ raider: string } | { view: string } | null}
     */
    function viewTarget(hash, search) {
        var h = "";
        try {
            h = decodeURIComponent(hash || "").replace(/^#/, "");
        } catch {
            h = (hash || "").replace(/^#/, "");
        }
        var q = new URLSearchParams(search || "").get("player");
        if (q) return { raider: q };
        var m = h.match(/^raider-(.+)$/);
        if (m) return { raider: m[1] };
        if (h === "raid" || h === "bosse" || h === "raider") return { view: h };
        return null;
    }

    /** The raider view's filter: role ("all", "open" or a role) and a lower-case name part. */
    function cardVisible(card, role, q) {
        var ok = true;
        if (role === "open") ok = Number(card.open || 0) > 0;
        else if (role !== "all") ok = card.role === role;
        if (ok && q) ok = (card.name || "").toLowerCase().indexOf(q) >= 0;
        return ok;
    }

    /** The RPB tables' filter: a row shows when its role and its name match. */
    function rowVisible(row, role, q) {
        var query = (q || "").toLowerCase();
        return (role === "all" || row.role === role) && (!query || (row.name || "").toLowerCase().indexOf(query) >= 0);
    }

    var helpers = {
        csrfFrom: csrfFrom, errorText: errorText, reportIdOf: reportIdOf, reviewState: reviewState, reviewBody: reviewBody,
        phraseBody: phraseBody, phraseDoneText: phraseDoneText, mappingLabel: mappingLabel, statusLine: statusLine,
        previewText: previewText, sendResult: sendResult, viewTarget: viewTarget, cardVisible: cardVisible, rowVisible: rowVisible,
        STATE_LABEL: STATE_LABEL, STATE_TONE: STATE_TONE,
    };
    if (typeof module !== "undefined" && module.exports) module.exports = helpers;
    if (typeof document === "undefined") return;

    // ---- shared plumbing -----------------------------------------------------------

    var token = null;
    function csrf() {
        if (token) return Promise.resolve(token);
        return fetch("/api/session", { credentials: "same-origin" })
            .then(function (r) {
                return r.json();
            })
            .then(function (j) {
                token = csrfFrom(j);
                return token;
            });
    }
    function jsonHeaders(t) {
        return { "Content-Type": "application/json", "X-CSRF-Token": t };
    }
    function post(url, t, body) {
        return fetch(url, { method: "POST", credentials: "same-origin", headers: jsonHeaders(t), body: JSON.stringify(body) });
    }
    /** The parsed answer of a POST, rejected with its message when it failed. */
    function checked(r) {
        return r.json().then(function (j) {
            if (!r.ok) throw new Error(errorText(j, r.status));
            return j;
        });
    }
    function getJson(url) {
        return fetch(url, { credentials: "same-origin" }).then(function (r) {
            return r.json();
        });
    }
    function toggleActive(list, active) {
        list.forEach(function (x) {
            x.classList.toggle("active", x === active);
        });
    }

    // ---- data-show: section buttons, try pills and the view switch -----------------
    document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-show]");
        if (!b) return;
        var btns = b.parentElement.querySelectorAll("[data-show]");
        for (var i = 0; i < btns.length; i++) {
            var x = btns[i];
            var p = document.getElementById(x.getAttribute("data-show"));
            x.classList.toggle("active", x === b);
            if (p) p.hidden = x !== b;
        }
    });

    // ---- dialogs: [data-dialog] opens, [data-close] and a click on the backdrop close ----
    document.addEventListener("click", function (e) {
        var o = e.target.closest("[data-dialog]");
        if (o) {
            if (o.closest("summary")) e.preventDefault();
            if (o.disabled) return;
            var d = document.getElementById(o.getAttribute("data-dialog"));
            if (d && d.showModal) d.showModal();
            return;
        }
        var c = e.target.closest("[data-close]");
        if (c) {
            var dl = c.closest("dialog");
            if (dl) dl.close();
            return;
        }
        var dg = e.target.closest("dialog.dlg");
        if (dg && e.target === dg) dg.close();
    });
    document.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var o = e.target.closest && e.target.closest("[role=button][data-dialog]");
        if (!o || o !== e.target) return;
        e.preventDefault();
        o.click();
    });

    // ---- .dscope tools: role segment, search field and orientation of the RPB tables ----
    function applyScope(s) {
        var role = s.getAttribute("data-frole") || "all";
        var q = s.getAttribute("data-fq") || "";
        s.querySelectorAll("[data-role]").forEach(function (el) {
            el.hidden = !rowVisible({ role: el.getAttribute("data-role"), name: el.getAttribute("data-name") }, role, q);
        });
    }
    document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-frole]");
        if (b && b.tagName === "BUTTON") {
            var s = b.closest(".dscope");
            s.setAttribute("data-frole", b.getAttribute("data-frole"));
            toggleActive(b.parentElement.querySelectorAll("button[data-frole]"), b);
            applyScope(s);
            return;
        }
        var o = e.target.closest("[data-orient]");
        if (o) {
            o.closest(".dscope").classList.toggle("va", o.getAttribute("data-orient") === "a");
            toggleActive(o.parentElement.querySelectorAll("[data-orient]"), o);
        }
    });
    document.addEventListener("input", function (e) {
        var i = e.target;
        if (!i || !i.hasAttribute || !i.hasAttribute("data-fsearch")) return;
        var s = i.closest(".dscope");
        s.setAttribute("data-fq", i.value.trim());
        applyScope(s);
    });

    // ---- the view in the url: #raid / #bosse / #raider, #raider-<name>, ?player=<name> ----
    function showView(id) {
        var b = document.querySelector(".seg.views [data-show='view-" + id + "']");
        if (b) b.click();
    }
    function openRaider(name) {
        showView("raider");
        var cards = document.querySelectorAll(".raider-card");
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].getAttribute("data-name") === name) {
                cards[i].open = true;
                cards[i].scrollIntoView({ block: "start" });
                break;
            }
        }
    }
    function fromUrl() {
        var t = viewTarget(location.hash, location.search);
        if (t && t.raider) openRaider(t.raider);
        else if (t) showView(t.view);
    }
    document.addEventListener("click", function (e) {
        var b = e.target.closest(".seg.views [data-show]");
        if (!b) return;
        try {
            history.replaceState(null, "", "#" + b.getAttribute("data-show").replace(/^view-/, ""));
        } catch {
            /* a sandboxed frame may refuse it; the view switched anyway */
        }
    });
    fromUrl();
    window.addEventListener("hashchange", fromUrl);

    // ---- the raider view's role segment and search field ----------------------------
    var cardRole = "all";
    var cardQuery = "";
    function applyCards() {
        var any = false;
        document.querySelectorAll(".raider-card").forEach(function (c) {
            var ok = cardVisible({ open: c.getAttribute("data-open"), role: c.getAttribute("data-role"), name: c.getAttribute("data-name") }, cardRole, cardQuery);
            c.hidden = !ok;
            if (ok) any = true;
        });
        var empty = document.getElementById("raiderEmpty");
        if (empty) empty.hidden = any;
    }
    document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-rolefilter]");
        if (!b) return;
        cardRole = b.getAttribute("data-rolefilter");
        toggleActive(b.parentElement.querySelectorAll("[data-rolefilter]"), b);
        applyCards();
    });
    document.addEventListener("input", function (e) {
        if (!e.target || e.target.id !== "raiderSearch") return;
        cardQuery = e.target.value.trim().toLowerCase();
        applyCards();
    });

    // ---- open / close every visible raider card ---------------------------------------
    document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-cards]");
        if (!b) return;
        var cards = [].slice.call(document.querySelectorAll(".raider-card")).filter(function (d) {
            return !d.hidden;
        });
        var mode = b.getAttribute("data-cards");
        var open = mode === "open" || (mode === "toggle" && cards.some(function (d) {
            return !d.open;
        }));
        cards.forEach(function (d) {
            d.open = open;
        });
    });

    // ---- the player page's "Auffällige / Alle" segment over the fight table -------------
    document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-pfilter]");
        if (!b) return;
        var all = b.getAttribute("data-pfilter") === "all";
        toggleActive(b.parentElement.querySelectorAll("[data-pfilter]"), b);
        b.closest("section").querySelectorAll("tr[data-flag]").forEach(function (tr) {
            tr.hidden = !all && tr.getAttribute("data-flag") !== "1";
        });
    });

    // ---- "Alle senden": the mapping check and the send to every raider ---------------
    // The send button posts once and lists who got a DM and who was skipped and why;
    // "Zuordnung prüfen" fetches the per-raider mapping state without sending.
    function sendRow(cls, text) {
        var d = document.createElement("div");
        d.className = "rec-send-row " + cls;
        d.textContent = text;
        return d;
    }
    document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-send]");
        if (!b) return;
        var box = b.closest(".rec-send");
        var out = box.querySelector(".rec-send-result");
        var id = box.getAttribute("data-report");
        out.hidden = false;
        out.textContent = "…";
        var p;
        if (b.getAttribute("data-send") === "status") {
            p = getJson("/api/cla/recommendations/send?id=" + encodeURIComponent(id)).then(function (j) {
                out.textContent = "";
                var list = (j.data && j.data.players) || [];
                if (!list.length) out.appendChild(sendRow("muted", "Nichts freigegeben."));
                list.forEach(function (x) {
                    out.appendChild(sendRow(x.mapped ? "ok" : "warn", statusLine(x)));
                });
            });
        } else {
            if (!confirm("Jetzt allen Raidern ihre freigegebenen Punkte als Discord-DM senden?")) {
                out.hidden = true;
                return;
            }
            b.disabled = true;
            p = csrf()
                .then(function (t) {
                    return post("/api/cla/recommendations/send", t, { reportId: id });
                })
                .then(checked)
                .then(function (j) {
                    var d = j.data;
                    out.textContent = "";
                    out.appendChild(sendRow("ok", d.message));
                    (d.sent || []).forEach(function (s) {
                        out.appendChild(sendRow("ok", "Gesendet: " + s.name + " (" + s.items + " Punkte)"));
                    });
                    (d.skipped || []).forEach(function (s) {
                        out.appendChild(sendRow("warn", "Übersprungen: " + s.name + ": " + s.message));
                    });
                })
                .finally(function () {
                    b.disabled = false;
                });
        }
        p.catch(function (err) {
            out.textContent = "Fehler: " + err.message;
        });
    });

    // ---- "KI-Formulierung": start the phrasing job, poll until it is done, reload ------
    document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-phrase]");
        if (!b) return;
        var box = b.closest("[data-report]");
        var out = box.querySelector(".rec-send-result");
        var id = box.getAttribute("data-report");
        var who = box.getAttribute("data-name") || "";
        out.hidden = false;
        out.textContent = "KI-Formulierung läuft …";
        b.disabled = true;
        function poll() {
            return getJson("/api/cla/recommendations/phrase?id=" + encodeURIComponent(id)).then(function (j) {
                var job = j.data && j.data.job;
                if (!job || job.status === "running") {
                    return new Promise(function (res) {
                        setTimeout(res, 2500);
                    }).then(poll);
                }
                if (job.status === "error") throw new Error(job.error || "fehlgeschlagen");
                return j.data;
            });
        }
        csrf()
            .then(function (t) {
                return post("/api/cla/recommendations/phrase", t, phraseBody(id, who));
            })
            .then(checked)
            .then(poll)
            .then(function (d) {
                out.textContent = phraseDoneText(d.last);
                setTimeout(function () {
                    location.reload();
                }, 1200);
            })
            .catch(function (err) {
                out.textContent = "Fehler: " + err.message;
                b.disabled = false;
            });
    });

    // ---- a finding's verdict buttons: approve / reject / edit, own text, rule text -----
    var reportId = reportIdOf(location.pathname);
    function markState(li, box, s) {
        li.className = li.className.replace(/rec-state-\w+/, "rec-state-" + s);
        var lbl = li.querySelector(".rec-state");
        if (lbl) {
            lbl.textContent = STATE_LABEL[s];
            lbl.className = "badge rec-state " + STATE_TONE[s];
        }
        var ap = box.querySelector("[data-review=approve]");
        var rj = box.querySelector("[data-review=reject]");
        if (ap) ap.classList.toggle("ok", s === "approved");
        if (rj) rj.classList.toggle("bad", s === "rejected");
    }
    document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-review]");
        if (!b) return;
        if (b.closest("summary")) e.preventDefault();
        var li = b.closest(".rec");
        if (!li) return;
        var box = li.querySelector(".rec-review");
        var st = li.querySelector(".rec-status");
        var a = b.getAttribute("data-review");
        if (a === "edit") {
            li.open = true;
            var ed = li.querySelector(".rec-edit");
            if (ed) {
                ed.hidden = false;
                var ta = ed.querySelector("textarea");
                if (ta) ta.focus();
            }
            return;
        }
        if (a === "rule") {
            var r = li.querySelector(".rec-rule");
            if (r) {
                r.hidden = !r.hidden;
                b.lastChild.textContent = r.hidden ? "Regeltext zeigen" : "Regeltext verbergen";
            }
            return;
        }
        if (!box) return;
        var state = li.classList.contains("rec-state-approved") ? "approved" : li.classList.contains("rec-state-rejected") ? "rejected" : "open";
        var body = reviewBody({
            reportId: reportId, scope: box.getAttribute("data-scope"), player: box.getAttribute("data-player"), key: box.getAttribute("data-key"),
            action: a, state: state, text: a === "save" ? li.querySelector(".rec-text").value : undefined,
        });
        if (st) st.textContent = "…";
        csrf()
            .then(function (t) {
                return post("/api/cla/recommendations", t, body);
            })
            .then(checked)
            .then(function () {
                if (a === "save") {
                    var p = li.querySelector(".rec-body");
                    if (p && body.text) p.textContent = body.text;
                } else {
                    markState(li, box, reviewState(body.approved));
                }
                if (st) {
                    st.textContent = "gespeichert";
                    setTimeout(function () {
                        st.textContent = "";
                    }, 1500);
                }
            })
            .catch(function (err) {
                li.open = true;
                if (st) st.textContent = "Fehler: " + err.message;
            });
    });

    // ---- the send dialog of one raider: mapping badge, text segment, preview, save and send ----
    var mappingByReport = {};
    function loadMapping(d) {
        var b = d.querySelector(".map-badge");
        if (!b || b.getAttribute("data-done")) return;
        var id = d.getAttribute("data-report");
        var who = d.getAttribute("data-player");
        if (!mappingByReport[id]) mappingByReport[id] = getJson("/api/cla/recommendations/send?id=" + encodeURIComponent(id));
        mappingByReport[id]
            .then(function (j) {
                var x = ((j.data && j.data.players) || []).find(function (y) {
                    return y.name === who;
                });
                b.setAttribute("data-done", "1");
                if (!x) {
                    b.textContent = "nichts freigegeben";
                    return;
                }
                b.textContent = mappingLabel(x);
                b.className = "badge map-badge " + (x.mapped ? "ok" : "bad");
            })
            .catch(function () {
                b.textContent = "Zuordnung unbekannt";
            });
    }
    function preview(d) {
        var box = d.querySelector(".dm-items");
        if (!box) return;
        box.innerHTML = "";
        d.querySelectorAll(".send-item").forEach(function (it) {
            var t = it.querySelector(".send-text").value.trim();
            if (!t) return;
            var el = document.createElement("div");
            var b = document.createElement("b");
            b.textContent = it.getAttribute("data-title");
            el.appendChild(b);
            el.appendChild(document.createElement("br"));
            el.appendChild(document.createTextNode(previewText(t)));
            box.appendChild(el);
        });
    }
    /** Saves every point whose own text changed, one after the other; choosing KI/Regel again clears it (text ""). */
    function saveTexts(d, t, id, who) {
        return [].slice.call(d.querySelectorAll(".send-item")).reduce(function (p, it) {
            return p.then(function () {
                var text = it.getAttribute("data-mode") === "custom" ? it.querySelector(".send-text").value.trim() : "";
                if (text === (it.getAttribute("data-custom") || "")) return;
                return post("/api/cla/recommendations", t, { reportId: id, scope: "player", player: who, key: it.getAttribute("data-key"), text: text }).then(function (r) {
                    if (!r.ok) throw new Error("Speichern fehlgeschlagen (" + r.status + ")");
                    it.setAttribute("data-custom", text);
                });
            });
        }, Promise.resolve());
    }
    document.addEventListener("click", function (e) {
        var o = e.target.closest("[data-dialog^='send-']");
        if (o) {
            var dd = document.getElementById(o.getAttribute("data-dialog"));
            if (dd) loadMapping(dd);
        }
        var t = e.target.closest("[data-txt]");
        if (t) {
            var it = t.closest(".send-item");
            var m = t.getAttribute("data-txt");
            var ta = it.querySelector(".send-text");
            it.setAttribute("data-mode", m);
            toggleActive(it.querySelectorAll("[data-txt]"), t);
            ta.value = it.getAttribute("data-" + m) || "";
            ta.readOnly = m !== "custom";
            if (m === "custom") ta.focus();
            preview(t.closest("dialog"));
            return;
        }
        var a = e.target.closest("[data-sendact]");
        if (!a) return;
        var d = a.closest("dialog");
        var id = d.getAttribute("data-report");
        var who = d.getAttribute("data-player");
        var out = d.querySelector(".send-out");
        var act = a.getAttribute("data-sendact");
        var btns = d.querySelectorAll("[data-sendact]");
        out.textContent = "…";
        btns.forEach(function (x) {
            x.disabled = true;
        });
        csrf()
            .then(function (tok) {
                return saveTexts(d, tok, id, who).then(function () {
                    if (act === "save") {
                        out.textContent = "Gespeichert.";
                        return;
                    }
                    return post("/api/cla/recommendations/send", tok, { reportId: id, players: [who], force: act === "force" })
                        .then(checked)
                        .then(function (j) {
                            var res = sendResult(j.data);
                            out.textContent = res.text;
                            if (res.force) {
                                var f = document.createElement("button");
                                f.type = "button";
                                f.className = "btn btn-ghost btn-sm";
                                f.setAttribute("data-sendact", "force");
                                f.textContent = "Trotzdem erneut senden";
                                out.appendChild(document.createTextNode(" "));
                                out.appendChild(f);
                            }
                        });
                });
            })
            .catch(function (err) {
                out.textContent = "Fehler: " + err.message;
            })
            .then(function () {
                btns.forEach(function (x) {
                    x.disabled = false;
                });
            });
    });
    document.addEventListener("input", function (e) {
        if (e.target && e.target.classList && e.target.classList.contains("send-text")) preview(e.target.closest("dialog"));
    });

    // ---- tooltips: one floating box for the whole page, driven by data-tip / data-tip-sub ----
    // The native title box takes a second to appear and cannot be styled.
    var tipEl = null;
    var tipCur = null;
    function tipBox() {
        if (!tipEl) {
            tipEl = document.createElement("div");
            tipEl.id = "tip";
            document.body.appendChild(tipEl);
        }
        return tipEl;
    }
    function tipPlace(t) {
        var b = tipBox();
        var r = t.getBoundingClientRect();
        var tb = b.getBoundingClientRect();
        var x = r.left + r.width / 2 - tb.width / 2;
        var y = r.top - tb.height - 9;
        if (y < 8) y = r.bottom + 9;
        b.style.left = Math.max(8, Math.min(x, window.innerWidth - tb.width - 8)) + "px";
        b.style.top = y + "px";
    }
    function tipShow(t) {
        if (tipCur === t) return;
        tipCur = t;
        var b = tipBox();
        var sub = t.getAttribute("data-tip-sub");
        b.innerHTML = "<b></b>" + (sub ? "<i></i>" : "");
        b.querySelector("b").textContent = t.getAttribute("data-tip") || "";
        if (sub) b.querySelector("i").textContent = sub;
        b.classList.add("on");
        tipPlace(t);
    }
    function tipHide() {
        tipCur = null;
        if (tipEl) tipEl.classList.remove("on");
    }
    document.addEventListener("mouseover", function (e) {
        var t = e.target.closest("[data-tip]");
        if (t) tipShow(t);
        else if (tipCur && !e.target.closest("#tip")) tipHide();
    });
    document.addEventListener("mouseout", function (e) {
        if (tipCur && !e.relatedTarget) tipHide();
    });
    document.addEventListener("focusin", function (e) {
        var t = e.target.closest("[data-tip]");
        if (t) tipShow(t);
    });
    document.addEventListener("focusout", tipHide);
    // touch: a tap toggles the box (there is no hover), a tap elsewhere closes it
    document.addEventListener("pointerdown", function (e) {
        if (e.pointerType !== "touch") return;
        var t = e.target.closest("[data-tip]");
        if (!t) {
            tipHide();
            return;
        }
        if (tipCur === t) tipHide();
        else tipShow(t);
    });
    window.addEventListener("scroll", function () {
        if (tipCur) tipPlace(tipCur);
    }, true);

    // ---- theme toggle: the head's inline script set data-theme before the first paint ----
    var root = document.documentElement;
    var themeBtn = document.getElementById("themeBtn");
    if (themeBtn) {
        var SUN = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4\"/></svg>";
        var MOON = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z\"/></svg>";
        var effTheme = function () {
            return root.getAttribute("data-theme") || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
        };
        var paintTheme = function () {
            themeBtn.innerHTML = effTheme() === "dark" ? SUN : MOON;
        };
        themeBtn.addEventListener("click", function () {
            var n = effTheme() === "dark" ? "light" : "dark";
            root.setAttribute("data-theme", n);
            try {
                localStorage.setItem("eh-theme", n);
            } catch {
                /* private mode: the theme holds for this page only */
            }
            paintTheme();
        });
        paintTheme();
    }
})();
