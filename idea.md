there's a project in ../games/music called genost, that is a draft of the project. let's leave it as an archival POC, and implement a proper version here.
it should not work without available facebook/musicgen models medium and melody.
reuse as much of stuff from POC as possible.

main screen is select working directory, when you select it - you see a list of previous sessions (just like in chatgpt), with search and filter by tags, each session has name, title and quantity of artifacts. make it wide enough to show all the contents, but it should be collapsable with like a stabdard hamburger button.

## New Session
central part of main screen is 3 options - each is a title in style h1 (title) with some emoji, and paragraph of text below that explains what it is. we have: Stem constructor, Free Format, Midi generator.
When you press either of them - it creates a new session, mandatory attributes are free form name and bpm (you may change it overtime, you may select it from presets like rock, downtempo, ambient, dnb, jungle, techno, house etc). default is 120 bpm.  you may assign a tag to a session - new one from free-form text input or exising from a dropdown. also you may assign export folder for a session, so you then press on an artifact, press export - and artifact is being copied to that folder.

## Artifacts
in session you may create artifacts (audio clips, stems of audio clips, midi clips); 
  you may press on any artifact to open its location, convert it to midi so it adds like a midi artifact to your session (available for audio artifacts);
  start a new Stem Constructor or Free Form session from a midi clip (it generates audio artifact in current session and start session from that audio artifact), we need to generate some name for the session. 

# Midi generator
use amaai-lab/text2midi locally in order to generate midi file. 
generator is a text input for prompt, and quantity of stems to generate. use WaveRoll js lib to visualize each result, and allow to start a new session from this midi clip: we use pretty_mid + scipy to generate guide audio and feed it to musicgen, more details in Appendix 1. if you did not quite enjoy what you get - you can generate more midi files, but yu cannot edt prompt - just push + button near the prompt text, and it moves current contents into tab archive-1 (archive-2 etc) for later viewing, only keeping the prompt - and now you may edit text and generate fresh batch of midi files.

## Free Form session
it looks similar to Midi generator, but also has audio input where you can put a reference audio manually, or it may be linked from a different session, or you may select it from a tree-like structure with all session artifacts like session1/archive-3/artifact15.wav.
so when you have no reference audio - use medium model; if you have audio - use melody model. select how many audios to generate, it generates them. you may rename artifacts, by defaultthey have names like artifact1,2,3 etc. you may split artifact into stems (piano, drums, guitar etc) - just like we do now, it yields artifacts in sublist, each has its own volume knob - so you may adjust volumes, press merge - and generate premix of those stems and use it further on, just like in POC. on each artifact you may select to convert to audio mid or drum midi (see Appendix 2), export it to export folder, start a new session, or to open folder where this stem is located; all artifacts for one session should be put in the same folder, if you archive current state of session like described in midi - do not rename existing fodler to avoid breaking stuff, just append int (1, 2, 3) suffix to new folder name.

## Stem Constructor session
we want to have restricted templated set of constructors - one for arpeggio, one for bass, one for drums, one for pad, one for lead, one for keys, one for solo guitar, one for choir parts, one for scene in a game or movie, one for boss battle theme in a game, one for regular encounter in a game. it should 4-5 attributes max, prompt should be built carefully from these inputs, you may use one of existing values for each input or type your own. please take a look how people write prompts for such parts, and generate such constructors; user should select one, select how much entities to generate, press generate - and get bunch of options, it is similar to free-form. 
Prompt produced here for Atmospheric Pad should look something like '170 BPM, D minor, atmospheric pad, lush synthesizer, 90s intelligent jungle, clean mix'

## Starting a session from audio artifact
musgen audiofiles are dirty, so we actually want to call it call this option 'Start session from this melody). use appendix 2 first to get clean melody (stri drums, convert to midi), then use appendix 1 to generate clean sine audiom and only then feed it to a new session.


# Appendix 1: pretty_midi + scipy
Here is the clean implementation that takes a .mid file (or pretty_midi.PrettyMIDI object) and renders a pristine, dry sine-wave WAV file optimized specifically for MusicGen:

Python
from pathlib import Path
import numpy as np
import pretty_midi
from scipy.io import wavfile


def midi_to_clean_guide_wav(
    midi_input: str | pretty_midi.PrettyMIDI,
    output_wav_path: str = "output/guide_clean.wav",
    sample_rate: int = 32000,
) -> str:
    """Converts a MIDI file or object into a pitch-pure sine wave WAV file

    strictly formatted for MusicGen Melody chromagram extraction.
    """
    # 1. Load MIDI input
    if isinstance(midi_input, (str, Path)):
        pm = pretty_midi.PrettyMIDI(str(midi_input))
    else:
        pm = midi_input

    # Determine total audio length in samples
    end_time = pm.get_end_time()
    total_samples = int(np.ceil(end_time * sample_rate))
    audio_buffer = np.zeros(total_samples, dtype=np.float32)

    # 2. Render notes as pure sine waves with linear attack/decay envelopes
    for instrument in pm.instruments:
        if instrument.is_drum:
            continue  # Ignore drum tracks for harmonic melody guides

        for note in instrument.notes:
            start_sample = int(note.start * sample_rate)
            end_sample = int(note.end * sample_rate)
            note_samples = end_sample - start_sample

            if note_samples <= 0 or start_sample >= total_samples:
                continue

            # Convert MIDI note number to fundamental pitch frequency (Hz)
            freq = 440.0 * (2.0 ** ((note.pitch - 69) / 12.0))

            # Generate time array for the duration of the note
            t = np.arange(note_samples) / sample_rate

            # Generate pure sine wave
            sine = np.sin(2.0 * np.pi * freq * t)

            # Apply attack/decay envelope (10ms fade-in, 20ms fade-out)
            # This prevents digital clicking at note edges
            fade_in_len = min(int(0.010 * sample_rate), note_samples // 2)
            fade_out_len = min(int(0.020 * sample_rate), note_samples // 2)

            envelope = np.ones(note_samples, dtype=np.float32)
            if fade_in_len > 0:
                envelope[:fade_in_len] = np.linspace(0.0, 1.0, fade_in_len)
            if fade_out_len > 0:
                envelope[-fade_out_len:] = np.linspace(1.0, 0.0, fade_out_len)

            # Normalize note velocity (0.0 to 1.0 scale)
            velocity_scale = (note.velocity / 127.0) * 0.5
            rendered_note = sine * envelope * velocity_scale

            # Clip overflow if notes exceed bounds
            actual_end = min(start_sample + note_samples, total_samples)
            slice_len = actual_end - start_sample

            # Mix into the master buffer
            audio_buffer[start_sample:actual_end] += rendered_note[:slice_len]

    # 3. Prevent clipping distortion
    max_val = np.max(np.abs(audio_buffer))
    if max_val > 1.0:
        audio_buffer /= max_val

    # 4. Save as 16-bit PCM WAV at 32kHz
    out_file = Path(output_wav_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    audio_int16 = (audio_buffer * 32767).astype(np.int16)
    wavfile.write(str(out_file), sample_rate, audio_int16)

    print(f"Generated clean MIDI-guide WAV: {out_file.resolve()}")
    return str(out_file)
Step-by-Step Execution Chain
Now feed that output straight into MusicGen:

Python
import os
import torch
import torchaudio
from audiocraft.models import MusicGen

os.environ["HF_HOME"] = "/Volumes/YourSSDName/models"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

## 1. Generate pristine sine-wave guide audio from a .mid file
guide_wav = midi_to_clean_guide_wav(
    midi_input="chords.mid",
    output_wav_path="temp/sine_guide.wav",
    sample_rate=32000,
)

## 2. Pass to MusicGen Melody
model = MusicGen.get_pretrained("facebook/musicgen-melody", device=DEVICE)
model.set_generation_params(duration=30, cfg_coef=3.0, top_k=250)

reference_audio, sr = torchaudio.load(guide_wav)

## 3. Generate textured stems
prompt = "170 BPM, D minor, atmospheric synth pad, intelligent jungle"
output_stem = model.generate_with_chroma(
    descriptions=[prompt], melody_wav=reference_audio, melody_sample_rate=sr
)

torchaudio.save("output/pad_stem.wav", output_stem[0].cpu(), 32000)


# Appendix 2: Audio to midi.
1. Spotify's basic-pitch (Best Overall Replacement)
Spotify’s Basic Pitch is currently the gold standard for lightweight, high-accuracy audio-to-MIDI conversion in Python. It is significantly more accurate than Ableton’s "Convert Harmony/Melody to MIDI" because it uses a lightweight neural network to track pitch bend, note onsets, and polyphony simultaneously without creating messy overlapping notes.

Installation
Bash
pip install basic-pitch
CLI Usage (Instant MIDI Export)
You can run it directly from your terminal:

Bash
basic-pitch /path/to/output_directory /path/to/your_audio.wav
Python Script Usage
Bash
pip install basic-pitch mido
Python
from basic_pitch.inference import predict_and_save

## Converts WAV/MP3 to a pristine .mid file automatically
predict_and_save(
    audio_path_list=["input_melody.wav"],
    output_directory="output_midi",
    save_midi=True,
    sonify_prediction=False,
    save_model_outputs=False,
    save_npz=False
)
2. omnizart (Best for Extracting MIDI Beats & Drums)
Ableton’s "Convert Drums to MIDI" relies on transient energy spikes, often confusing sharp synth sounds with snares. Omnizart uses specialized deep-learning models for different instruments—including dedicated models for full drum kit transcription and polyphonic piano.

Installation & Usage
Bash
pip install omnizart
omnizart download-checkpoints
To transcribe drums specifically:

Bash
omnizart drum transcribe your_beat.wav -o output_drum.mid
To transcribe piano/synth chords:

Bash
omnizart music transcribe your_chords.wav -o output_chords.mid
How to Build a Clean MIDI Pre-Processor Pipeline
If you want to feed clean MIDI into your pretty_midi guide generator for musicgen-melody:

Extract Stems First: Run your reference audio through Demucs (pip install demucs) to separate vocals, drums, bass, and other synths.

Convert Melodic Stems with basic-pitch: Pass the isolated other.wav or bass.wav into basic_pitch to extract clean MIDI notes.

Synthesize Clean Sine Wave Guide: Render the .mid back to a clean sine-wave WAV file using pretty_midi (as in your existing pipeline) and pass it straight into musicgen-melody.
