// The story: what has happened, what to do next, and everything the valley has to say about it.

export const NOTES = {
  log: {
    title: 'Flight log, N7KR',
    place: 'the crash site',
    body: `17:02. Engine coughed over the ridge, then quit. Put her down on the slope. Everything hurts but I am walking.\n\nRadio is cracked: antenna snapped, battery dead. Storm front due at dark. So: find a way to call this in.\n\nNote to self: never trust a weather forecast from a man named Gary.`,
  },
  tower: {
    title: 'Pinned to the lookout wall',
    place: 'Ridgeback Lookout',
    body: `SEASON CLOSED.\n\nSpare antenna wire is on the desk. The cabin's long-range set lost its own to a squirrel (true story). Its battery is dead too. The old truck battery at Halloran Mine should do the job.\n\nStay on the trail!\n- Ranger Ines`,
  },
  camp: {
    title: 'Notebook page, torn out',
    place: 'the campsite',
    body: `Day 3. Bear box empty (thanks, Dave).\n\nWe saw a light up at the meadow last night. That is the ranger's cabin, maybe 2 km north-east, across the creek. The bridge is a bit sketchy.\n\nIf the weather turns, go there. Do not sleep in the tent!!`,
  },
  mine: {
    title: 'Taped to the shelf',
    place: 'Halloran Mine',
    body: `ABE HALLORAN'S MINE.\nKEEP OUT. The tunnel is sealed for a reason.\n\nTruck battery is on the bench. I rescued it from Dave's "restoration project". Take it if you need it, and please bring it back.\n- I.H.`,
  },
  bridge: {
    title: 'Nailed to the bridge post',
    place: 'the creek bridge',
    body: `TWO PLANKS ARE MISSING.\nJump the gap, or wade upstream where it is shallow.\n\nThe creek is snow-melt cold. Do NOT go swimming in the dark.`,
  },
  cabin: {
    title: "Ranger's log",
    place: 'Ranger Cabin',
    body: `Storm coming in hard tonight. If someone is reading this:\n\nThe fire is laid at Sunday Meadow, kindling under the tarp, dry birch bark in the porch box. The rescue helicopter can only land in the meadow.\n\nLight the fire. Fire a flare when you hear rotors. Don't be a hero. Stay warm.`,
  },
  peak: {
    title: 'Summit register',
    place: 'Kestrel Point',
    body: `Made it! Legs are jelly. The view is unreal. 9 September.\n- T & K\n\n(Someone has drawn a very rude moose underneath.)`,
  },
  lake: {
    title: 'Fisherman\'s note, in a jar',
    place: 'Alder Lake',
    body: `Caught nothing. The fish here are smarter than I am.\n\nIf you get thirsty: creek water, not lake water, and BOIL IT. Giardia is not a fun souvenir.`,
  },
};

export const RADIO = {
  advisory: [
    ['Ranger Station', '...all stations, automated advisory. Severe storm warning for Kestrel Valley. Heavy rain, lightning and high winds from dusk.'],
    ['Ranger Station', 'All hikers seek shelter at Ranger Cabin, Sunday Meadow. Long-range radio at the cabin. Repeating...'],
  ],
  call: [
    ['You', 'Mayday, mayday. This is Kestrel Seven-Kilo-Romeo, down in Kestrel Valley. Anyone copy?'],
    ['Dispatch', 'Seven-Kilo-Romeo, this is Rescue Coordination. We have you. Thank God. Are you injured?'],
    ['You', 'Bruised and cold, but walking. I am at Ranger Cabin. Storm is building.'],
    ['Dispatch', 'Copy. The front grounds everything until the worst has passed. Earliest window is 22:30. Kestrel Two will come for you at Sunday Meadow.'],
    ['Dispatch', 'Build a fire there. It is the only thing they will see in this weather. Fire a flare when you hear rotors. Stay warm, stay dry, stay alive.'],
  ],
  heliClose: [
    ['Kestrel Two', 'Base, I have a light on the ground. I see your fire. Coming in.'],
    ['Kestrel Two', 'Stand clear of the rotors. Wait for my signal.'],
  ],
  heliFlare: [['Kestrel Two', 'Flare sighted! Hold your position, I am coming to you.']],
};

// Ordered objectives. `target` names a place the compass and map point to.
export const OBJECTIVES = [
  { id: 'kit', text: 'Search the wreckage for your survival kit.', target: 'wreck' },
  { id: 'tower', text: 'Climb Ridgeback Lookout and find its spare antenna.', target: 'tower' },
  { id: 'battery', text: 'Find a battery. Halloran Mine, north-west, might have one.', target: 'mine' },
  { id: 'radio', text: 'Cross the creek to Ranger Cabin and get the radio working.', target: 'cabin' },
  { id: 'fire', text: 'Light the signal fire on Sunday Meadow. Stay warm until the helicopter comes.', target: 'lz' },
  { id: 'rescue', text: 'Signal the helicopter with the flare, then get aboard.', target: 'lz' },
];

export const HINTS = {
  move: 'WASD to move, mouse to look, Shift to run, Space to jump.',
  interact: 'Press E to pick things up and use them.',
  pack: 'Press Tab to open your backpack.',
  torch: 'Press F for the flashlight. Its battery does not last forever.',
  cold: 'You are getting cold. Find shelter, keep moving, or build a fire (G).',
  wet: 'You are soaked. Wet clothes steal your warmth: get somewhere dry.',
  thirst: 'You are thirsty. Drink from the creek (boil it or use a tablet to be safe).',
  hunger: 'You are hungry. Eat something from your backpack.',
  night: 'Night is falling. Keep to the trail and watch your footing.',
  fire: 'Press G to build a fire (3 firewood and a match). Warmth and light.',
  rest: 'Hold R near a fire or indoors to rest and let time pass.',
};
