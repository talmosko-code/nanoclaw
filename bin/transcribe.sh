#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  transcribe.sh <audio-file> [--model small] [--out /path/to/out.txt] [--language auto] [--compute-type int8] [--beam-size 5] [--json]

Defaults:
  --model small           (tiny, base, small, medium, large-v3)
  --compute-type int8     (int8, int16, float16, float32)
  --beam-size 5           (1-10, higher = more accurate but slower)
  --language auto         (auto-detection, or e.g. "he", "en")
  --json                  output JSON with timestamps
EOF
  exit 2
}

if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

in="${1:-}"
shift || true

model="small"
out=""
language=""
compute_type="int8"
beam_size="5"
response_format="text"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      model="${2:-}"
      shift 2
      ;;
    --out)
      out="${2:-}"
      shift 2
      ;;
    --language)
      language="${2:-}"
      shift 2
      ;;
    --compute-type)
      compute_type="${2:-}"
      shift 2
      ;;
    --beam-size)
      beam_size="${2:-}"
      shift 2
      ;;
    --json)
      response_format="json"
      shift 1
      ;;
    --output)
      out="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      ;;
  esac
done

if [[ ! -f "$in" ]]; then
  echo "File not found: $in" >&2
  exit 1
fi

if [[ "$out" == "" ]]; then
  base="${in%.*}"
  if [[ "$response_format" == "json" ]]; then
    out="${base}.json"
  else
    out="${base}.txt"
  fi
fi

mkdir -p "$(dirname "$out")"

# Venv lives in data/whisper-venv/ relative to the project root (two levels up from bin/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PATH="${WHISPER_VENV_PATH:-${PROJECT_ROOT}/data/whisper-venv}"

if [[ ! -f "${VENV_PATH}/bin/python" ]]; then
  echo "Virtual environment not found at ${VENV_PATH}" >&2
  echo "Set up with:" >&2
  echo "  python3 -m venv ${VENV_PATH}" >&2
  echo "  ${VENV_PATH}/bin/pip install faster-whisper" >&2
  exit 1
fi

echo "Transcribing with faster-whisper (model: $model, device: cpu, compute: $compute_type)..." >&2

# Build Python command
python_cmd="from faster_whisper import WhisperModel
import json
import sys

model = WhisperModel('$model', device='cpu', compute_type='$compute_type')
segments, info = model.transcribe('$in', beam_size=$beam_size"

if [[ -n "$language" && "$language" != "auto" ]]; then
  python_cmd="$python_cmd, language='$language'"
fi

python_cmd="$python_cmd)

# Convert generator to list to reuse
segments_list = list(segments)

lang_prob = getattr(info, 'language_probability', None)
if lang_prob is not None:
    print(f'Detected language: {info.language} (prob: {lang_prob:.2f})', file=sys.stderr)
else:
    print(f'Detected language: {info.language}', file=sys.stderr)
print(f'Duration: {info.duration:.1f}s', file=sys.stderr)

if '$response_format' == 'json':
    result = {
        'text': ' '.join(segment.text for segment in segments_list),
        'language': info.language,
        'duration': info.duration,
        'segments': [
            {
                'start': segment.start,
                'end': segment.end,
                'text': segment.text,
                'words': getattr(segment, 'words', [])
            }
            for segment in segments_list
        ]
    }
    with open('$out', 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
else:
    with open('$out', 'w', encoding='utf-8') as f:
        for segment in segments_list:
            f.write(segment.text.strip() + '\\n')
"

# Run transcription
"${VENV_PATH}/bin/python" -c "$python_cmd"

echo "Saved to: $out" >&2
echo "$out"
