# Rhythm Guessing — static web app

This is a small rhythm-guessing web app intended for piano and singing tutors.

Features
- Three difficulty levels: Easy, Medium, Difficult
- Generates a 2-bar rhythm per question following level rules
- Renders rhythms visually using VexFlow (via CDN)
- Presents 4 options (one correct + 3 distractors)
- Bottom-left toast messages: green for "Correct!" and red for "Incorrect! The correct option is option X"

How to run
1. Open `index.html` in a modern browser (no server required). VexFlow is loaded via CDN.

Notes & assumptions
- Time signature is 4/4 (each bar = 4 beats, 2 bars total)
- Internally the smallest unit is a 32nd note (demisemiquaver)
- Medium includes dotted notes and triplet groups (shown as triplet of eighths)
- Difficult picks half of the basic types (semibreve..demisemiquaver) to guarantee variety