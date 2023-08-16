module.exports = classMap = {
    // Pala
    'Holy1': { icon: 'holypala', name: 'Holy Paladin' },
    'Protection1': { icon: 'protpala', name: 'Protection Pala' },
    'Retribution': { icon: 'retribution', name: 'Retribution Pala' },
    //Warrior
    'Fury': { icon: 'fury', name: 'Fury Warrior' },
    'Arms': { icon: 'arms', name: 'Arms Warrior' },
    'Protection': { icon: 'protection', name: 'Protection Warrior' },
    //Rogue
    'Assassination': { icon: 'assassination', name: 'Assassination Rogue' },
    'Combat': { icon: 'combat', name: 'Combat Rogue' },
    'Subtlety': { icon: 'sublety', name: 'Sublety Rogue' },
    //Priest
    'Discipline': { icon: 'discipline', name: 'Discipline Priest' },
    'Shadow': { icon: 'shadow', name: 'Shadow Priest' },
    'Holy': { icon: 'holypriest', name: 'Holy Priest' },
    //Hunter
    'Beastmastery': { icon: 'beastmastery', name: 'Beast Mastery Hunter' },
    'Marksmanship': { icon: 'marksman', name: 'Marksman Hunter' },
    'Survival': { icon: 'survival', name: 'Survival Hunter' },
    // Warlock
    'Demonology': { icon: 'demonology', name: 'Demonology Warlock' },
    'Affliction': { icon: 'affliction', name: 'Affliction Warlock' },
    'Destruction': { icon: 'destruction', name: 'Destruction Warlock' },
    //Mage
    'Fire': { icon: 'firemage', name: 'Fire Mage' },
    'Arcane': { icon: 'arcane', name: 'Arcane Mage' },
    'Frost': { icon: 'frostmage', name: 'Frost Mage' },
    //Druid
    'Guardian': { icon: 'guardian', name: 'Feral Tank' },
    'Feral': { icon: 'feral', name: 'Feral Druid' },
    'Balance': { icon: 'balance', name: 'Balance Druid' },
    'Restoration': { icon: 'restoration', name: 'Restoration Druid' },
    //Death Knight
    'Unholy_DPS': { icon: 'unholy', name: 'Unholy Deathknight' },
    'Unholy_Tank': { icon: 'unholy', name: 'Unholy Tank' },
    'Frost_Tank': { icon: 'frostdk', name: 'Frost Tank' },
    'Frost_DPS': { icon: 'frostdk', name: 'Frost Deathknight' },
    'Blood_Tank': { icon: 'blood', name: 'Blood Tank' },
    'Blood_DPS': { icon: 'blood', name: 'Blood Deathknight' },
    //Shaman
    'Restoration1': { icon: 'restosham', name: 'Restoration Shaman' },
    'Elemental': { icon: 'elemental', name: 'Elemental Shaman' },
    'Enhancement': { icon: 'enhancement', name: 'Enhancement Shaman' },
}

module.exports = shortClassList = {
    // Pala
    'Holy1': { icon: 'holypala', name: 'Holy Paladin', clazz: 'Paladin' },
    'Protection1': { icon: 'protpala', name: 'Protection Pala', clazz: 'Paladin' },
    'Retribution': { icon: 'retribution', name: 'Retribution Pala', clazz: 'Paladin' },
    //Warrior
    'Fury': { icon: 'fury', name: 'Fury Warrior', clazz: 'Warrior' },
    'Arms': { icon: 'arms', name: 'Arms Warrior', clazz: 'Warrior' },
    'Protection': { icon: 'protection', name: 'Protection Warrior', clazz: 'Warrior' },
    //Rogue
    'Assassination': { icon: 'assassination', name: 'Assassination Rogue', clazz: 'Rogue' },
    'Combat': { icon: 'combat', name: 'Combat Rogue', clazz: 'Rogue' },
    //Priest
    'Discipline': { icon: 'discipline', name: 'Discipline Priest', clazz: 'Priest' },
    'Shadow': { icon: 'shadow', name: 'Shadow Priest', clazz: 'Priest' },
    'Holy': { icon: 'holypriest', name: 'Holy Priest', clazz: 'Priest' },
    //Hunter
    'Survival': { icon: 'survival', name: 'Survival Hunter', clazz: 'Hunter' },
    // Warlock
    'Demonology': { icon: 'demonology', name: 'Demonology Warlock', clazz: 'Warlock' },
    'Affliction': { icon: 'affliction', name: 'Affliction Warlock', clazz: 'Warlock' },
    //Mage
    'Fire': { icon: 'firemage', name: 'Fire Mage', clazz: 'Mage' },
    'Arcane': { icon: 'arcane', name: 'Arcane Mage', clazz: 'Mage' },
    'Frost': { icon: 'frost', name: 'Frost Mage', clazz: 'Mage' },
    //Druid
    'Feral': { icon: 'feral', name: 'Feral Druid', clazz: 'Druid' },
    'Balance': { icon: 'balance', name: 'Balance Druid', clazz: 'Druid' },
    'Restoration': { icon: 'restoration', name: 'Restoration Druid', clazz: 'Druid' },
    //Death Knight
    'Unholy_DPS': { icon: 'unholy', name: 'Unholy Deathknight', clazz: 'Deathknight' },
    'Frost_DPS': { icon: 'frostdk', name: 'Frost Deathknight', clazz: 'Deathknight' },
    'Blood_Tank': { icon: 'blood', name: 'Blood Tank', clazz: 'Deathknight' },
    //Shaman
    'Restoration1': { icon: 'restosham', name: 'Restoration Shaman', clazz: 'Shaman' },
    'Elemental': { icon: 'elemental', name: 'Elemental Shaman', clazz: 'Shaman' },
    'Enhancement': { icon: 'enhancement', name: 'Enhancement Shaman', clazz: 'Shaman' },
}

module.exports = extendedClassList = {
    // Pala
    'Holy1': { icon: 'holypala', name: 'Holy Paladin', clazz: 'Paladin', spec: 'Holy1' },
    'HolyPala': { icon: 'holypala', name: 'Holy Paladin', clazz: 'Paladin', spec: 'Holy1' },
    'Protection1': { icon: 'protpala', name: 'Protection Pala', clazz: 'Tank', spec: 'Protection1' },
    'ProtPala': { icon: 'protpala', name: 'Protection Pala', clazz: 'Tank', spec: 'Protection1' },
    'Retribution': { icon: 'retribution', name: 'Retribution Pala', clazz: 'Paladin', spec: 'Retribution' },
    'Retri': { icon: 'retribution', name: 'Retribution Pala', clazz: 'Paladin', spec: 'Retribution' },
    'PALADIN': { icon: 'paladin', name: 'Paladin', clazz: 'Paladin', spec: 'paladin' },
    //Warrior
    'Fury': { icon: 'fury', name: 'Fury Warrior', clazz: 'Warrior', spec: 'Fury' },
    'Arms': { icon: 'arms', name: 'Arms Warrior', clazz: 'Warrior', spec: 'Arms' },
    'Protection': { icon: 'protection', name: 'Protection Warrior', clazz: 'Warrior', spec: 'Protection' },
    'ProtWarrior': { icon: 'protection', name: 'Protection Warrior', clazz: 'Tank', spec: 'Protection' },
    'WARRIOR': { icon: 'warrior', name: 'Warrior', clazz: 'Tank', spec: 'Warrior' },
    //Rogue
    'Assassination': { icon: 'assassination', name: 'Assassination Rogue', clazz: 'Rogue', spec: 'Assassination' },
    'Assa': { icon: 'assassination', name: 'Assassination Rogue', clazz: 'Rogue', spec: 'Assassination' },
    'Sublety': { icon: 'sublety', name: 'Sublety Rogue', clazz: 'Rogue', spec: 'Sublety' },
    'Combat': { icon: 'combat', name: 'Combat Rogue', clazz: 'Rogue', spec: 'Combat' },
    'ROGUE': { icon: 'rogue', name: 'Rogue', clazz: 'Rogue', spec: 'rogue' },
    //Priest
    'Discipline': { icon: 'discipline', name: 'Discipline Priest', clazz: 'Priest', spec: 'Discipline' },
    'Disc': { icon: 'discipline', name: 'Discipline Priest', clazz: 'Priest', spec: 'Discipline' },
    'Shadow': { icon: 'shadow', name: 'Shadow Priest', clazz: 'Priest', spec: 'Shadow' },
    'HolyPriest': { icon: 'holypriest', name: 'Holy Priest', clazz: 'Priest', spec: 'HolyPriest' },
    'PRIEST': { icon: 'priest', name: 'Priest', clazz: 'Priest', spec: 'Priest' },
    //Hunter
    'Survival': { icon: 'survival', name: 'Survival Hunter', clazz: 'Hunter', spec: 'Survival' },
    'Marksman': { icon: 'marksman', name: 'Marksman Hunter', clazz: 'Hunter', spec: 'Marksman' },
    'Beastmaster': { icon: 'beastmastery', name: 'Beastmaster Hunter', clazz: 'Hunter', spec: 'Beastmastery' },
    'HUNTER': { icon: 'survival', name: 'Survival Hunter', clazz: 'Hunter', spec: 'Survival' },
    // Warlock
    'Demonology': { icon: 'demonology', name: 'Demonology Warlock', clazz: 'Warlock', spec: 'Demonology' },
    'Demo': { icon: 'demonology', name: 'Demonology Warlock', clazz: 'Warlock', spec: 'Demonology' },
    'Affliction': { icon: 'affliction', name: 'Affliction Warlock', clazz: 'Warlock', spec: 'Affliction' },
    'Affli': { icon: 'affliction', name: 'Affliction Warlock', clazz: 'Warlock', spec: 'Affliction' },
    'Destro': { icon: 'destruction', name: 'Destruction Warlock', clazz: 'Warlock', spec: 'Destruction' },
    'WARLOCK': { icon: 'warlock', name: 'Warlock', clazz: 'Warlock', spec: 'warlock' },
    //Mage
    'Fire': { icon: 'firemage', name: 'Fire Mage', clazz: 'Mage', spec: 'Fire' },
    'Arcane': { icon: 'arcane', name: 'Arcane Mage', clazz: 'Mage', spec: 'Arcane' },
    'Frost': { icon: 'frostmage', name: 'Frost Mage', clazz: 'Mage', spec: 'Frost' },
    'MAGE': { icon: 'mage', name: 'Mage', clazz: 'Mage', spec: 'mage' },
    //Druid
    'Feral': { icon: 'feral', name: 'Feral Druid', clazz: 'Druid', spec: 'Feral' },
    'Guardian': { icon: 'guardian', name: 'Feral Tank', clazz: 'Druid', spec: 'Guardian' },
    'Balance': { icon: 'balance', name: 'Balance Druid', clazz: 'Druid', spec: 'Balance' },
    'Restoration': { icon: 'restoration', name: 'Restoration Druid', clazz: 'Druid', spec: 'Restoration' },
    'RestoDruid': { icon: 'restoration', name: 'Restoration Druid', clazz: 'Druid', spec: 'Restoration' },
    'DRUID': { icon: 'druid', name: 'Druid', clazz: 'Druid', spec: 'druid' },
    //Death Knight
    'Unholy_DPS': { icon: 'unholy', name: 'Unholy Deathknight', clazz: 'DK', spec: 'Unholy_DPS' },
    'UnholyDK': { icon: 'unholy', name: 'Unholy Deathknight', clazz: 'DK', spec: 'Unholy_DPS' },
    'Frost_DPS': { icon: 'frostdk', name: 'Frost Deathknight', clazz: 'DK', spec: 'Frost_DPS' },
    'FrostDK': { icon: 'frostdk', name: 'Frost Deathknight', clazz: 'DK', spec: 'Frost_DPS' },
    'Blood_Tank': { icon: 'blooddk', name: 'Blood Tank', clazz: 'DK', spec: 'Blood_Tank' },
    'BloodDK': { icon: 'blooddk', name: 'Blood Deathknight', clazz: 'DK', spec: 'Blood_DPS' },
    'DEATHKNIGHT': { icon: 'deathknight', name: 'Deathknight', clazz: 'DK', spec: 'Deathknight' },
    //Shaman
    'Restoration1': { icon: 'restosham', name: 'Restoration Shaman', clazz: 'Shaman', spec: 'Restoration1' },
    'RestoSham': { icon: 'restosham', name: 'Restoration Shaman', clazz: 'Shaman', spec: 'Restoration1' },
    'Elemental': { icon: 'elemental', name: 'Elemental Shaman', clazz: 'Shaman', spec: 'Elemental' },
    'EleSham': { icon: 'elemental', name: 'Elemental Shaman', clazz: 'Shaman', spec: 'Elemental' },
    'Enhancement': { icon: 'enhancement', name: 'Enhancement Shaman', clazz: 'Shaman', spec: 'Enhancement' },
    'Enhancer': { icon: 'enhancement', name: 'Enhancement Shaman', clazz: 'Shaman', spec: 'Enhancement' },
    'SHAMAN': { icon: 'shaman', name: 'Shaman', clazz: 'Shaman', spec: 'Shaman' },
}