add web ui for a song project that helps generating the song.
start page is select folder with projects, when you select it - it shows you list of proojects as big square card with titla and last modified at, and Create New Project option. 
project view has 5 tabs. 
1st has a text input with overall composition aesthetics (general prompt - bpm, references, idea of the track).
2nd has block declaration - name, duration in bars, instruments, what melody do they play, prompt for the melody, master volume, level of master delay, level of master reverb, compressor on/off.. 
    has list of implemented melodies and button re-generate on each of them.
3rd is arranger mode - put blocks on a timeline, select variation number 1-16. if two identical blocks with different variation names exist - we need to 
    generate different passes for them, one is variation of another. also each block may have an input - if no input, it's a seed block, just brand new 
    based on song prompt only; it it has input - use melody AI model instead of medium AI model. timeline is multi-layered so you may layer as many stuff on top as you want. 
4th is player - it has build button that builds from arranger mode, just glues all layers regarding block volume levels, skips ungenerated blocks, and after the build 
    is done  - player button is active, you may play, pause, refind forward and backward - primitive player capabilities. also it should have nmaster mix panel, with params for master delay, mater reverb and master limiter.
5th is list of all music components to render. nothing renders by default, you need to go here and press render all or find redired element and render / pause / rerender.

each variation of a block is a different stem, different row on 5th tab and a separate file in the file system (inside project's STEMS folder). stem name is visible on each block.

use tailwind, some more endy techno vibes in design, call it GENOST.
use TUNA lib for SFX
