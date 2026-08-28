from __future__ import annotations

import argparse
import json
import os
import pickle
import sys
from pathlib import Path


class Text2MidiRuntime:
    def __init__(self, repo_path: Path):
        sys.path.insert(0, str(repo_path))
        try:
            import torch
            import torch.nn as nn
            from huggingface_hub import hf_hub_download
            from model.transformer_model import Transformer
            from transformers import T5Tokenizer
        except Exception as exc:
            raise RuntimeError(f"Text2midi runtime dependencies are unavailable: {exc}") from exc

        self.torch = torch
        self.nn = nn
        if torch.cuda.is_available():
            self.device = torch.device("cuda")
        elif torch.backends.mps.is_available():
            self.device = torch.device("mps")
        else:
            self.device = torch.device("cpu")

        cache_dir = os.environ.get("HF_HOME") or os.environ.get("AUDIOCRAFT_CACHE_DIR")
        download_args = {
            "repo_id": "amaai-lab/text2midi",
            "cache_dir": cache_dir,
            "local_files_only": True,
        }
        model_path = hf_hub_download(filename="pytorch_model.bin", **download_args)
        tokenizer_path = hf_hub_download(filename="vocab_remi.pkl", **download_args)
        with open(tokenizer_path, "rb") as handle:
            self.midi_tokenizer = pickle.load(handle)

        self.model = Transformer(
            len(self.midi_tokenizer),
            768,
            8,
            2048,
            18,
            1024,
            False,
            8,
            device=self.device,
        )
        self.model.load_state_dict(torch.load(model_path, map_location=self.device))
        self.model.to(self.device)
        self.model.eval()
        self.text_tokenizer = T5Tokenizer.from_pretrained(
            "google/flan-t5-base",
            cache_dir=cache_dir,
            local_files_only=True,
        )

    def generate(self, prompt: str, output_path: Path, seed: int) -> None:
        self.torch.manual_seed(seed)
        inputs = self.text_tokenizer(prompt, return_tensors="pt", padding=True, truncation=True)
        input_ids = self.nn.utils.rnn.pad_sequence(
            inputs.input_ids,
            batch_first=True,
            padding_value=0,
        ).to(self.device)
        attention_mask = self.nn.utils.rnn.pad_sequence(
            inputs.attention_mask,
            batch_first=True,
            padding_value=0,
        ).to(self.device)
        with self.torch.no_grad():
            output = self.model.generate(input_ids, attention_mask, max_len=2000, temperature=1.0)
        generated_midi = self.midi_tokenizer.decode(output[0].tolist())
        temporary = output_path.with_name(f".{output_path.stem}.{seed}.tmp.mid")
        generated_midi.dump_midi(str(temporary))
        temporary.replace(output_path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    args = parser.parse_args()
    runtime = Text2MidiRuntime(Path(args.repo).expanduser().resolve())
    print(json.dumps({"status": "ready", "device": str(runtime.device)}), flush=True)

    for line in sys.stdin:
        try:
            request = json.loads(line)
            prompt = str(request["prompt"])
            outputs = [Path(value).expanduser().resolve() for value in request["outputs"]]
            seeds = [int(value) for value in request["seeds"]]
            if len(outputs) != len(seeds):
                raise ValueError("Every Text2midi output requires one seed")
            for output_path, seed in zip(outputs, seeds, strict=True):
                output_path.parent.mkdir(parents=True, exist_ok=True)
                if output_path.exists():
                    raise FileExistsError(f"Text2midi output already exists: {output_path}")
                runtime.generate(prompt, output_path, seed)
            response = {"status": "ready", "outputs": [str(path) for path in outputs]}
        except Exception as exc:
            response = {"status": "failed", "error": str(exc)}
        print(json.dumps(response), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
