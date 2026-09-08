// Darkness and the lights that cut holes in it.
//
// 165 of this pack's 387 maps are declared DARK and the browser was drawing every one of
// them at noon. Native's model is three steps (Client/MirScenes/GameScene.cs:10589 and
// DrawLights below it): decide the ambient colour, blend a soft ellipse at every actor
// that carries a light, then multiply the scene by the result. Every table here is
// native's; the drawing itself lives in world.js.

export const LIGHT_SETTING = { Normal: 0, Dawn: 1, Day: 2, Evening: 3, Night: 4 };

// A map set to Normal follows the server's clock; anything else overrides it
// (GameScene.cs:10589).
export function effectiveSetting(mapLights, worldLights) {
  return Number(mapLights) === LIGHT_SETTING.Normal
    ? Number(worldLights) || LIGHT_SETTING.Day
    : Number(mapLights);
}

// Day needs no overlay at all, which is also the cheap path for most towns. Takes the
// setting effectiveSetting already resolved, so Normal here means nothing is known yet.
export function needsDarkness(setting) {
  const resolved = Number(setting) || LIGHT_SETTING.Day;
  return resolved !== LIGHT_SETTING.Day;
}

// MapDarkLight lets a map pick the colour of its night. 0 is the ordinary pitch black;
// the rest are the named .NET colours native switches on.
const NIGHT_TINTS = {
  1: 0x141414,
  2: 0x778899, // LightSlateGray
  3: 0x87ceeb, // SkyBlue
  4: 0xdaa520, // Goldenrod
};

export function darknessColour(setting, mapDarkLight = 0) {
  switch (Number(setting)) {
    case LIGHT_SETTING.Night:
      return NIGHT_TINTS[Number(mapDarkLight)] ?? 0x000000;
    case LIGHT_SETTING.Evening:
    case LIGHT_SETTING.Dawn:
      return 0x323232;
    default:
      return 0xffffff;
  }
}

// DXManager.LightSizes. Index 0 is the smallest ellipse a light can be.
export const LIGHT_SIZES = [
  [125, 95], [205, 156], [285, 217], [365, 277], [445, 338], [525, 399],
  [605, 460], [685, 521], [765, 581], [845, 642], [925, 703],
];

// A light's byte packs two things: the low digit is how far it reaches and the high digit
// is how bright it burns, so a light of 47 is radius 2 at the third brightness.
//
// The index maps one off the table, and deliberately. CreateLights builds its textures
// from LightSizes[1..10], so native's Lights[k] is really LightSizes[k+1] -- it then
// offsets the draw by LightSizes[k], which is why a light in the original sits slightly
// off its actor. The size below is the one native actually draws; the offset is not
// reproduced, because that part is a bug rather than a look.
export function lightSize(light) {
  const index = Math.min(Math.max(Number(light) % 15, 0), LIGHT_SIZES.length - 2);
  return LIGHT_SIZES[index + 1];
}

// Players light the way by what they carry: nothing, a candle, a torch, a peddler's
// torch. Merchants glow faintly. Everything else uses the light colour it was given,
// which for a monster is white.
const PLAYER_BRIGHTNESS = [0x3c3c3c, 0x787878, 0xb4b4b4, 0xf0f0f0];

export function lightColour(light, kind) {
  if (kind === "npc") return 0x787878;
  if (kind !== "player") return 0xffffff;
  const step = Math.floor(Number(light) / 15);
  return PLAYER_BRIGHTNESS[step] ?? 0xffffff;
}

// The gradient DXManager.CreateLights paints into every light texture: white at the
// centre falling to transparent at the rim, in five uneven steps.
export const LIGHT_STOPS = [
  [0.0, 255, 255], [0.2, 210, 255], [0.4, 160, 255],
  [0.6, 70, 255], [0.8, 40, 255], [1.0, 0, 0],
];

/// <summary>Which actors light the scene, and where.</summary>
// A dead actor stops emitting, except the player -- whose own light is what lets you see
// your corpse and walk back (DrawLights: `!ob.Dead || ob == MapObject.User`).
export function lightsFor(entities, user) {
  const lights = [];
  for (const entity of entities) {
    const light = Number(entity.Light) || 0;
    if (light <= 0) continue;
    if (entity.Dead && entity !== user) continue;
    lights.push({ entity, size: lightSize(light), colour: lightColour(light, entity.kind) });
  }
  return lights;
}
