// Nothing in Crystal makes a dropped item shine: ItemObject.Draw is one plain
// BodyLibrary.Draw call and native's DrawEffects for an item is empty. The glint is this
// client's own, so its job is legibility -- a small icon lying on a dark dungeon floor is
// easy to walk past -- and the one thing it takes from the game is the grade colour, which
// is native's own (GameScene.cs:6797: Common yellow, Rare deep sky blue, Legendary dark
// orange, Mythical plum, Heroic red).
const GRADE_COLOURS = [0xffe9a8, 0xffe000, 0x00bfff, 0xff8c00, 0xdda0dd, 0xff2d2d];

export const GLINT_PERIOD = 1400;

export function glintColour(grade) {
    const index = Number.isInteger(grade) && grade >= 0 && grade < GRADE_COLOURS.length ? grade : 0;
    return GRADE_COLOURS[index];
}

/// <summary>Where in its blink an item is, spread so a pile does not pulse in lockstep.</summary>
// The object id is the offset because it is the one number every dropped item has and no
// two share, so two items on the same cell never flash together.
export function glintPhase(now, objectID) {
    const spread = Math.abs(Number(objectID) || 0) * 137;
    return ((now + spread) % GLINT_PERIOD) / GLINT_PERIOD;
}

/// <summary>The star to draw this frame: arm length, core size, halo and alpha.</summary>
// A grade raises all three, so a Legendary on the floor reads as worth walking to from
// further away than a Common. The lit part of the cycle is over half of it -- the earlier
// version was lit for 28% of 1.8s, which is most of two seconds spent invisible.
export function glintStyle(grade, phase) {
    const rank = Number.isInteger(grade) && grade > 0 ? Math.min(grade, 5) : 0;
    const duty = 0.6;
    const lit = phase < duty ? Math.sin((phase / duty) * Math.PI) : 0;
    return {
        colour: glintColour(rank),
        arm: 9 + rank * 2.5,
        core: 3 + rank * 0.5,
        halo: rank >= 2 ? 5 + rank * 1.5 : 0,
        alpha: lit * (0.75 + rank * 0.05),
    };
}
