// Lines people shout in a fight. tools/voices/generate.py reads this file
// (it must stay import-free) and records each line in each gunman's voice.
export const BARK_VOICES = ['Gunman A', 'Gunman B', 'Gunman C'];

export const BARKS = {
  spot: ['There he is!', 'Over there! Get him!', 'It\'s him! Open fire!', 'We got company!'],
  taunt: ['You\'re a dead man!', 'Come on out and die!', 'Keep shooting, boys!', 'Flank him!', 'He can\'t hide forever!'],
  hurt: ['I\'m hit!', 'Argh! My arm!', 'Damn you!'],
  reload: ['Reloading!', 'Cover me!'],
};

// The player's own remarks
export const COLE_LINES = {
  kill: ['Stay down.', 'That\'s one.', 'Shouldn\'t have drawn on me.', 'Got him.'],
};
