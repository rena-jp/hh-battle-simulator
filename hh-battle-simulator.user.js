// ==UserScript==
// @name         Hentai Heroes Battle Simulator
// @namespace    https://github.com/rena-jp/hh-battle-simulator
// @version      2.9
// @description  Add a battle simulator to Hentai Heroes and related games
// @author       rena
// @match        https://*.hentaiheroes.com/*
// @match        https://nutaku.haremheroes.com/*
// @match        https://*.gayharem.com/*
// @match        https://*.comixharem.com/*
// @match        https://*.hornyheroes.com/*
// @match        https://*.pornstarharem.com/*
// @match        https://*.transpornstarharem.com/*
// @grant        none
// @run-at       document-body
// @updateURL    https://github.com/rena-jp/hh-battle-simulator/raw/main/hh-battle-simulator.user.js
// @downloadURL  https://github.com/rena-jp/hh-battle-simulator/raw/main/hh-battle-simulator.user.js
// ==/UserScript==

window.HHBattleSimulator = {
    /**
     * @param {*} playerRawData - hero_data
     * @param {*} opponentRawData - opponent_fighter.player
     * @returns {Promise<number>} - Player's chance of winning
     */
    async calcChance(playerRawData, opponentRawData) {
        const player = calcBattleData(playerRawData, opponentRawData);
        const opponent = calcBattleData(opponentRawData, playerRawData);
        const preSim = checkChanceFromBattleData(player, opponent);
        return await calcChanceFromBattleData(player, opponent, preSim);
    },
    /**
     * @param {*} playerRawData - hero_data
     * @param {*} opponentRawData - opponent_fighter.player
     * @returns {Promise<{ chance: number, point: number }>} - Player's winning chance and expected point
     */
    async calcChanceAndPoint(playerRawData, opponentRawData) {
        const player = calcBattleData(playerRawData, opponentRawData);
        const opponent = calcBattleData(opponentRawData, playerRawData);
        return await calcChanceAndPointFromBattleData(player, opponent);
    },
};

const workerScript = (() => {
    self.addEventListener('message', e => {
        const { func, args } = e.data;
        const f = self[func];
        const ret = f(...args);
        self.postMessage({ func, ret });
    });

    function calcChance(player, opponent) {
        player.win = 1;
        opponent.win = 0;
        return attack(player, player.ego, player.attack, player.defense, opponent, opponent.ego, opponent.attack, opponent.defense);

        function attack(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense) {
            attackerAttack *= attacker.attackMultiplier;
            defenderDefense *= attacker.defenseMultiplier;
            const baseDamage = Math.max(0, Math.floor(attackerAttack - defenderDefense));
            if (attackerEgo / attacker.ego >= defenderEgo / defender.ego) {
                const baseResult = hit(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense, baseDamage);
                if (baseResult == attacker.win) return attacker.win;
                const critDamage = baseDamage * attacker.critMultiplier;
                const critResult = hit(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense, critDamage);
                return baseResult * attacker.baseHitChance + critResult * attacker.critHitChance;
            } else {
                const critDamage = baseDamage * attacker.critMultiplier;
                const critResult = hit(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense, critDamage);
                if (critResult == 1 - attacker.win) return 1 - attacker.win;
                const baseResult = hit(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense, baseDamage);
                return baseResult * attacker.baseHitChance + critResult * attacker.critHitChance;
            }
        }

        function hit(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense, damage) {
            defenderEgo -= Math.ceil(damage);
            if (defenderEgo <= 0) return attacker.win;
            attackerEgo += Math.ceil(damage * attacker.healing);
            attackerEgo = Math.min(attackerEgo, attacker.ego);
            return attack(defender, defenderEgo, defenderAttack, defenderDefense, attacker, attackerEgo, attackerAttack, attackerDefense);
        }
    }

    function calcChanceAndPoint(player, opponent) {
        player.win = ego => ({ chance: 1, point: Math.ceil(10 * ego / player.ego) + 15 });
        opponent.win = ego => ({ chance: 0, point: Math.ceil(10 * (opponent.ego - ego) / (opponent.ego)) + 3 });
        return attack(player, player.ego, player.attack, player.defense, opponent, opponent.ego, opponent.attack, opponent.defense);

        function attack(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense) {
            attackerAttack *= attacker.attackMultiplier;
            defenderDefense *= attacker.defenseMultiplier;
            const baseDamage = Math.max(0, Math.floor(attackerAttack - defenderDefense));
            const baseResult = hit(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense, baseDamage);
            const critDamage = baseDamage * attacker.critMultiplier;
            const critResult = hit(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense, critDamage);
            return {
                chance: baseResult.chance * attacker.baseHitChance + critResult.chance * attacker.critHitChance,
                point: baseResult.point * attacker.baseHitChance + critResult.point * attacker.critHitChance
            };
        }

        function hit(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense, damage) {
            defenderEgo -= Math.ceil(damage);
            attackerEgo += Math.ceil(damage * attacker.healing);
            attackerEgo = Math.min(attackerEgo, attacker.ego);
            if (defenderEgo <= 0) return attacker.win(attackerEgo);
            return attack(defender, defenderEgo, defenderAttack, defenderDefense, attacker, attackerEgo, attackerAttack, attackerDefense);
        }
    }
}).toString().slice(6);

const workerBlob = new Blob([workerScript], { type: 'text/javascript' });
const workerURL = URL.createObjectURL(workerBlob);
const maxWorkers = navigator?.hardwareConcurrency ?? 1;
const minWorkers = 1;
let runningWorkers = 0;
const waiterQueue = [];
const workerPool = [];

async function getWorker() {
    const worker = workerPool.pop();
    if (worker != null) {
        return worker;
    } else if (runningWorkers < maxWorkers) {
        runningWorkers++;
        return new Worker(workerURL);
    } else {
        return new Promise(resolve => {
            waiterQueue.push(resolve);
        });
    }
}

function releaseWorker(worker) {
    const waiter = waiterQueue.shift();
    if (waiter != null) {
        waiter(worker);
    } else if (workerPool.length < minWorkers) {
        workerPool.push(worker);
    } else {
        worker.terminate();
        runningWorkers--;
    }
}

async function workerRun(func, args) {
    const worker = await getWorker();
    const promise = new Promise((resolve, reject) => {
        worker.addEventListener('message', e => { resolve(e.data.ret); });
        worker.addEventListener("messageerror", e => { reject(e); });
        worker.addEventListener('error', e => { reject(e); });
    });
    promise.then(() => { releaseWorker(worker); });
    worker.postMessage({ func, args });
    return promise;
}

async function calcChanceFromBattleData(player, opponent, preSim) {
    if (preSim.alwaysWin) {
        return 1;
    } else if (preSim.neverWin) {
        return 0;
    } else {
        return await workerRun('calcChance', [player, opponent]);
    }
}

async function calcChanceAndPointFromBattleData(player, opponent) {
    return await workerRun('calcChanceAndPoint', [player, opponent]);
}

function checkChanceFromBattleData(player, opponent) {
    const results = { alwaysWin: true, neverWin: true };
    const newPlayer = { ...player, results: results };
    const newOpponent = { ...opponent, results: { } };
    normalHit(newPlayer, player.ego, player.attack, player.defense, newOpponent, opponent.ego, opponent.attack, opponent.defense);
    criticalHit(newPlayer, player.ego, player.attack, player.defense, newOpponent, opponent.ego, opponent.attack, opponent.defense);
    return results;

    function normalHit(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense) {
        attackerAttack *= attacker.attackMultiplier;
        defenderDefense *= attacker.defenseMultiplier;

        const baseDamage = Math.max(0, Math.floor(attackerAttack - defenderDefense));
        defenderEgo -= baseDamage;
        if (defenderEgo <= 0) {
            attacker.results.neverWin = false;
            defender.results.alwaysWin = false;
            return;
        }

        const normalHealing = Math.ceil(baseDamage * attacker.healing);
        attackerEgo += normalHealing;
        attackerEgo = Math.min(attackerEgo, attacker.ego);

        criticalHit(defender, defenderEgo, defenderAttack, defenderDefense, attacker, attackerEgo, attackerAttack, attackerDefense);
    }

    function criticalHit(attacker, attackerEgo, attackerAttack, attackerDefense, defender, defenderEgo, defenderAttack, defenderDefense) {
        attackerAttack *= attacker.attackMultiplier;
        defenderDefense *= attacker.defenseMultiplier;

        const baseDamage = Math.max(0, Math.floor(attackerAttack - defenderDefense));
        const criticalDamage = Math.ceil(baseDamage * attacker.critMultiplier);
        defenderEgo -= criticalDamage;
        if (defenderEgo <= 0) {
            attacker.results.neverWin = false;
            defender.results.alwaysWin = false;
            return;
        }

        const criticalHealing = Math.ceil(baseDamage * attacker.critMultiplier * attacker.healing);
        attackerEgo += criticalHealing;
        attackerEgo = Math.min(attackerEgo, attacker.ego);

        normalHit(defender, defenderEgo, defenderAttack, defenderDefense, attacker, attackerEgo, attackerAttack, attackerDefense);
    }
}

function calcBattleData(fighterRawData, opponentRawData) {
    const synergyBonuses = Object.fromEntries(
        fighterRawData.team.synergies.map(e => [e.element.type, e.bonus_multiplier])
    );

    let chance = 0.30 * fighterRawData.chance / (fighterRawData.chance + opponentRawData.chance);
    chance += synergyBonuses.stone;

    const chanceDominations = ['darkness', 'light', 'psychic'];
    fighterRawData.team.theme_elements.forEach(e => {
        if (chanceDominations.includes(e.type) && opponentRawData.team.theme.includes(e.domination)) {
            chance += 0.2;
        }
    });

    const getSkillPercentage = id => fighterRawData.team.girls
        .map(e => e.skills[id]?.skill.percentage_value ?? 0)
        .reduce((p, c) => p + c, 0) / 100;

    return {
        ego: Math.ceil(fighterRawData.remaining_ego),
        attack: fighterRawData.damage,
        defense: fighterRawData.defense,
        baseHitChance: 1 - chance,
        critHitChance: chance,
        critMultiplier: 2 + synergyBonuses.fire,
        healing: synergyBonuses.water,
        attackMultiplier: 1 + getSkillPercentage(9),
        defenseMultiplier: 1 + getSkillPercentage(10),
    };
}

function checkPage(...args) {
    return args.some(e => window.location.pathname.includes(e));
}

function toRoundedNumber(value, m) {
    return Math.round(value * m) / m;
}

function toPercentage(value) {
    const percentage = 100 * value;
    if (percentage > 99.99) return '100%';
    if (percentage >= 99.9) return '99.9%';
    if (percentage >= 10) return `${toRoundedNumber(percentage, 10)}%`;// 10%-99.9%
    if (percentage >= 0.01) return `${toRoundedNumber(percentage, 100)}%`;// 0.01%-9.99%
    if (percentage >= 9.5e-4) return `${percentage.toPrecision(1)}%`; // 0.001%-0.01%
    return '0%';
};

function getRiskColor(chance) {
    const value = (chance ** 3) * 2;
    const red = Math.round(255 * Math.sqrt(Math.min(1, 2 - value)));
    const green = Math.round(255 * Math.sqrt(Math.min(1, value)));
    return `rgb(${red}, ${green}, 0)`;
}

function getMojoColor(mojo) {
    const rate = Math.max(0, Math.min(40, mojo + 10)) / 40;
    const value = 1 + Math.sin(Math.PI * (rate * rate - 0.5));
    const red = Math.round(255 * Math.sqrt(Math.min(1, 2 - value)));
    const green = Math.round(255 * Math.sqrt(Math.min(1, value)));
    return `rgb(${red}, ${green}, 0)`;
}

const TableHelper = (() => {
    const column = (span, content) => span >= 2 ? `<td colspan="${span}">${content}</td>` : `<td>${content}</td>`;
    const columns = (span, contents) => contents.map(e => column(span, e)).join('');
    const row = (...args) => ['<tr>', ...args, '</tr>'].join('');
    return { column, columns, row };
})();

function createChanceElement$(chancePromise, player, opponent, preSim) {
    const $element = $('<div class="sim-result"></div>');
    if (preSim.alwaysWin) {
        $element
            .html(`<div class="sim-label">P[W]:</div><div class="vCheck_mix_icn sim-mark"></div><span class="sim-chance">${toPercentage(1)}</span>`)
            .css('color', getRiskColor(1));
    } else if(preSim.neverWin) {
        $element
            .html(`<div class="sim-label">P[W]:</div><div class="xUncheck_mix_icn sim-mark"></div><span class="sim-chance">${toPercentage(0)}</span>`)
            .css('color', getRiskColor(0));
    } else {
        $element
            .addClass('sim-pending')
            .html('<div class="sim-label">P[W]:</div>-');
        queueMicrotask(update);
    }
    return $element
        .attr('tooltip', createBattleTable());

    async function update() {
        const chance = await chancePromise;
        $element
            .removeClass('sim-pending')
            .html(`<div class="sim-label">P[W]:</div><span class="sim-chance">${toPercentage(chance)}</span>`)
            .css('color', getRiskColor(chance));
    }

    function createBattleTable() {
        const { column, columns, row } = TableHelper;
        const createTable = (attacker, defender) => {
            let attackerAttack = attacker.attack;
            let defenderDefense = defender.defense;
            const rows = [];
            for (let i = 0; i < 10; i++) {
                const baseDamage = Math.max(0, Math.floor(attackerAttack - defenderDefense));
                const columns = [];
                columns.push(baseDamage);
                columns.push(Math.ceil(baseDamage * attacker.healing));
                columns.push(Math.ceil(baseDamage * attacker.critMultiplier));
                columns.push(Math.ceil(baseDamage * attacker.critMultiplier * attacker.healing));
                rows.push(columns);
                attackerAttack *= attacker.attackMultiplier;
                defenderDefense *= attacker.defenseMultiplier;
            }
            return rows;
        };
        const playerTable = createTable(player, opponent);
        const opponentTable = createTable(opponent, player);
        const chanceRow = [player, opponent].flatMap(e => [e.baseHitChance, e.critHitChance]);
        return $('<table class="sim-table"></table>')
            .append(row(column(1, ''), columns(4, ['Player', 'Opponent'])))
            .append(row(column(1, ''), columns(2, ['Normal', 'Critical']).repeat(2)))
            .append(row(column(1, '%'), columns(2, chanceRow.map(e => toPercentage(e)))))
            .append(row(column(1, ''), columns(1, ['Damage', 'Healing']).repeat(4)))
            .append(
                Array(9).fill().map((_, i) => i + 1)
                    .map(i => row(
                        column(1, i),
                        [playerTable, opponentTable].map(table => columns(1, table[i].map(e => e.toLocaleString()))),
                    ))
            )
            .prop('outerHTML');
    }
}

function createMojoElement$(chancePromise, winMojo) {
    const $element = $('<div class="sim-result"></div>')
        .addClass('sim-pending')
        .html('<div class="sim-label">E[M]:</div>-');
    queueMicrotask(update);
    return $element;

    async function update() {
        const winChance = await chancePromise;
        const lossChance = 1 - winChance;
        const lossMojo = winMojo - 40;
        const odds = winMojo * winChance + lossMojo * lossChance;
        $element
            .removeClass('sim-pending')
            .html(`<div class="sim-label">E[M]:</div><span class="sim-mojo">${toRoundedNumber(odds, 100)}</span>`)
            .css('color', getMojoColor(odds))
            .attr('tooltip', createMojoTable());

        function createMojoTable() {
            const { column, columns, row } = TableHelper;
            return $('<table class="sim-table"></table>')
                .append(row(column(1, ''), columns(1, ['Win', 'Loss'])))
                .append(row(column(1, 'Mojo'), columns(1, [winMojo, lossMojo].map(e => toRoundedNumber(e, 100)))))
                .append(row(column(1, '%'), columns(1, [winChance, lossChance].map(e => toPercentage(e)))))
                .append(row(column(1, 'E[M]'), column(2, toRoundedNumber(odds, 100))))
                .prop('outerHTML');
        }
    }
}

function createPointElement$(pointPromise) {
    const $element = $('<div class="sim-result"></div>')
        .addClass('sim-pending')
        .html('<div class="sim-label">E[P]:</div>-');
    queueMicrotask(update);
    return $element;

    async function update() {
        const point = await pointPromise;
        $element
            .removeClass('sim-pending')
            .html(`<div class="sim-label">E[P]:</div><span class="sim-point">${toRoundedNumber(point, 100)}</span>`)
            .css('color', getRiskColor(point / 25));
    }
}

(async function () {
    if (document.readyState === 'loading') {
        await new Promise(resolve => {
            window.addEventListener('DOMContentLoaded', () => {
                resolve();
            }, { capture: true, once: true });
        });
    }

    if (!window.$) throw new Error('jQuery not found.');
    /* global $ */

    addStyle();

    const afterGameInited = new Promise(resolve => {
        $(() => { resolve(); });
    });

    if (checkPage('/troll-pre-battle.html', '/pantheon-pre-battle.html')) {
        const { hero_data, opponent_fighter } = window;
        if (!hero_data) throw new Error('hero_data not found.');
        if (!opponent_fighter) throw new Error('opponents not found.');
        if (!opponent_fighter.player) throw new Error('opponent_fighter.player not found.');

        const playerRawData = hero_data;
        const opponentRawData = opponent_fighter.player;
        const player = calcBattleData(playerRawData, opponentRawData);
        const opponent = calcBattleData(opponentRawData, playerRawData);
        const preSim = checkChanceFromBattleData(player, opponent);
        const chancePromise = calcChanceFromBattleData(player, opponent, preSim);

        await afterGameInited;

        $('.opponent .icon-area')
            .before(createChanceElement$(chancePromise, player, opponent, preSim).addClass('sim-left'));
    }

    if (checkPage('/leagues-pre-battle.html')) {
        const { hero_data, opponent_fighter } = window;
        if (!hero_data) throw new Error('hero_data not found.');
        if (!opponent_fighter) throw new Error('opponent_fighter not found.');
        if (!opponent_fighter.player) throw new Error('opponent_fighter.player not found.');

        const playerRawData = hero_data;
        const opponentRawData = opponent_fighter.player;
        const player = calcBattleData(playerRawData, opponentRawData);
        const opponent = calcBattleData(opponentRawData, playerRawData);
        const chanceAndPointPromise = calcChanceAndPointFromBattleData(player, opponent);
        const chancePromise = chanceAndPointPromise.then(e => e.chance);
        const pointPromise = chanceAndPointPromise.then(e => e.point);

        await afterGameInited;

        $('.opponent .icon-area')
            .before(createChanceElement$(chancePromise, player, opponent, { }).addClass('sim-left'))
            .before(createPointElement$(pointPromise).addClass('sim-right'));
    }

    if (checkPage('/season-arena.html')) {
        const { hero_data, caracs_per_opponent, opponents } = window;
        if (!hero_data) throw new Error('hero_data not found.');
        if (!caracs_per_opponent) throw new Error('caracs_per_opponent not found.');
        if (!opponents) throw new Error('opponents not found.');
        if (opponents.some(e => !e.player)) throw new Error('opponents[].player not found.');

        opponents.forEach(async opponent_fighter => {
            const opponentRawData = opponent_fighter.player;
            const opponentId = opponentRawData.id_fighter;
            const playerRawData = { ...hero_data, ...caracs_per_opponent[opponentId] };
            const player = calcBattleData(playerRawData, opponentRawData);
            const opponent = calcBattleData(opponentRawData, playerRawData);
            const preSim = checkChanceFromBattleData(player, opponent);
            const chancePromise = calcChanceFromBattleData(player, opponent, preSim);
            const mojo = +opponent_fighter.rewards.rewards.find(e => e.type === 'victory_points').value;

            await afterGameInited;

            $(`[data-opponent="${opponentId}"] .icon-area`)
                .before(createChanceElement$(chancePromise, player, opponent, preSim).addClass('sim-left'))
                .before(createMojoElement$(chancePromise, mojo).addClass('sim-right'));
        });
    }

    const avoidOverlap = () => {
        if ($('.matchRating').length > 0) {
            $('.sim-result').addClass('sim-top');
        }
    };
    avoidOverlap();
    const observer = new MutationObserver(avoidOverlap);
    document.querySelectorAll('.player_team_block.opponent, .season_arena_opponent_container').forEach(e => {
        observer.observe(e, { childList: true, subtree: true });
    });
})();

function addStyle() {
    $(document.head).append(`<style>
.sim-result {
    width: max-content;
    height: 0;
    position: relative;
    bottom: 1.25rem;
    line-height: 1.25rem;
    text-align: center;
    text-shadow: -1px -1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, 1px 1px 0 #000;
    z-index: 1;
}
.sim-result .sim-label {
    font-size: 0.75rem;
}
.sim-result.sim-left {
    margin-right: 60%;
}
.sim-result.sim-right {
    margin-left: 60%;
}
.sim-result.sim-top {
    bottom: 11.5rem;
    line-height: 1rem;
}
.sim-result.sim-pending {
    color: #999;
}
.sim-mark {
    display: inline-block;
    width: 1.5rem;
    height: 1.5rem;
    margin: -0.5rem 0.25rem 0 -1.5rem;
    background-size: 1.5rem;
    vertical-align: bottom;
}
table.sim-table {
    border-collapse: collapse;
    color: #FFF;
    background-color: #000;
    font-size: 0.75rem;
}
table.sim-table td {
    padding: 0.25rem;
    border: 1px solid #999;
}
</style>`);
}
