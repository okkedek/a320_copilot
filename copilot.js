import {MSFS_API} from "msfs-simconnect-api-wrapper/msfs-api.js";
import emitter from 'tiny-emitter/instance.js';
import sound from 'sound-play/src/index.js';
import path from 'path';

const PHASE = {
    INIT: {
        label: "Initial",
        next: () => PHASE.PARKED,
    },
    PARKED: {
        label: "Parked",
        next: () => PHASE.TAXI_OUT,
    },
    TAXI_OUT: {
        label: "Taxi to runway",
        next: () => PHASE.TAKEOFF,
    },
    TAKEOFF: {
        label: "Takeoff",
        next: () => PHASE.CLIMB,
    },
    CLIMB: {
        label: "Climb",
        next: () => PHASE.CRUISE,
    },
    CRUISE: {
        label: "Cruise",
        next: () => PHASE.DESCENT,
    },
    DESCENT: {
        label: "Descent",
        next: () => PHASE.APPROACH,
    },
    APPROACH: {
        label: "Approach",
        next: () => PHASE.LANDING,
    },
    LANDING: {
        label: "Landing",
        next: () => PHASE.TAXI_IN,
    },
    TAXI_IN: {
        label: "Taxi to the gate",
        next: () => PHASE.PARKED,
    }
}
const CHIME_ALT = 10200;
const api = new MSFS_API();

let conn_retried = false;
let fl_p = 0;
let alt_p = 0;
let phase_alt_p = 0;
let phase_info = {
    phase: PHASE.INIT,
    next_met: 0
};
api.connect({
    retries: Infinity,
    retryInterval: 5,
    autoReconnect: true,
    onConnect: (handle) => run(handle),
    onRetry: (_, interval) => {
        conn_retried = true;
        console.log(`Waiting for sim: retrying in ${interval} seconds.`);
    },
    onException: (e) => error(e),
});

async function run() {
    console.log(`Connected to MSFS.`);
    if (conn_retried) {
        console.log('Waiting 30s to let MSFS load...')
        await new Promise(resolve => setTimeout(resolve, 30000));
    }
    await sound.play(path.resolve('audio/connected.wav'));

    await set_initial_phase();

    console.log("Init monitors");
    api.schedule((v) => monitor_alt(v.INDICATED_ALTITUDE), 1000, 'INDICATED_ALTITUDE')
    api.schedule(
        ({
             AIRSPEED_INDICATED: spd,
             INDICATED_ALTITUDE: alt
         }) => monitor_phase(spd, alt),
        1000,
        'INDICATED_ALTITUDE', 'AIRSPEED_INDICATED'
    );

    emitter.on('phase-change', on_phase_change);
}

async function set_initial_phase() {
    let {AIRSPEED_INDICATED: spd, INDICATED_ALTITUDE: alt} = await api.get('INDICATED_ALTITUDE', 'AIRSPEED_INDICATED');
    phase_info.phase = initial_phase(spd, alt);
    console.log('Initial phase:', phase_info.phase.label);
}

function initial_phase(spd, alt) {
    for (let phase in PHASE) {
        if (meets_phase(PHASE[phase], spd, alt)) {
            return PHASE[phase];
        }
    }

    return PHASE.INIT;
}

async function error(e) {
    console.log(e)
    await sound.play(path.resolve('audio/error.wav'));
}

async function monitor_alt(alt) {
    let alt_c = alt
    let alt_d = alt_c - alt_p;
    let fl_c;

    if (Math.abs(alt_d) < 5) {
        fl_c = Math.round(alt_c / 1000);
    } else if (alt_d < 0) {
        fl_c = Math.ceil(alt_c / 1000);
    } else {
        fl_c = Math.floor(alt_c / 1000);
    }

    if (fl_p !== fl_c) {
        console.log('Altitude: ', fl_c * 1000);
    }

    if (alt_c < CHIME_ALT && alt_p > CHIME_ALT) {
        alt_p = alt_c;
        console.log('10000ft announcement...');
        await sound.play(path.resolve('audio/10000.wav'));
    }
    alt_p = alt_c;
    fl_p = fl_c;
}

async function monitor_phase(spd, alt) {
    if (!meets_phase(phase_info.phase.next(), spd, alt)) return;
    if (phase_info.next_met++ > 2) {
        phase_info.phase = phase_info.phase.next();
        phase_info.next_met = 0;
        emitter.emit('phase-change', phase_info.phase);
    }
}

async function on_phase_change(phase) {
    console.log('Phase:', phase.label);
    switch (phase) {
        case PHASE.CRUISE:
            await sound.play(path.resolve('audio/cruise.wav'));
            break;
        case PHASE.DESCENT:
            await sound.play(path.resolve('audio/descent.wav'));
            break;
        case PHASE.APPROACH:
            await sound.play(path.resolve('audio/approach.wav'));
            break;
    }
}

function meets_phase(phase, spd, alt) {
    let met;
    switch (phase) {
        case PHASE.PARKED:
            return spd < 2 && alt < 1000;
        case PHASE.TAXI_OUT:
            return spd > 2 && spd < 32 && alt < 1000;
        case PHASE.TAKEOFF:
            return spd > 32 && spd < 150 && alt < 1000;
        case PHASE.CLIMB:
            met = spd > 120 && alt > phase_alt_p;
            phase_alt_p = alt;
            return met;
        case PHASE.CRUISE:
            met = alt > 18500 && spd > 260 && Math.abs(alt - phase_alt_p) < 10;
            phase_alt_p = alt;
            return met;
        case PHASE.DESCENT:
            met = spd > 250 && (alt - phase_alt_p) < -5;
            phase_alt_p = alt;
            return met;
        case PHASE.APPROACH:
            met = spd < 165 && alt < phase_alt_p;
            phase_alt_p = alt;
            return met;
        case PHASE.LANDING:
            met = spd < 140 && alt < phase_alt_p && alt < 1000;
            phase_alt_p = alt;
            return met;
        case PHASE.TAXI_IN:
            return spd > 2 && spd < 32 && alt < 1000;
    }
    return false;
}