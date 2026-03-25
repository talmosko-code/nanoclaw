"""
Transcribe an audio file using faster-whisper.
Usage: transcribe.py <audio-file> [--model small] [--language he]
Prints the transcript to stdout.
"""
import argparse
import sys

from faster_whisper import WhisperModel


def main() -> None:
    parser = argparse.ArgumentParser(description='Transcribe audio with faster-whisper')
    parser.add_argument('audio_file', help='Path to audio file')
    parser.add_argument('--model', default='small', help='Model size (default: small)')
    parser.add_argument('--language', default=None, help='Language code (default: auto-detect)')
    parser.add_argument('--compute-type', default='int8', dest='compute_type')
    parser.add_argument('--beam-size', type=int, default=5, dest='beam_size')
    args = parser.parse_args()

    model = WhisperModel(args.model, device='cpu', compute_type=args.compute_type)
    segments, info = model.transcribe(
        args.audio_file,
        beam_size=args.beam_size,
        language=args.language,
    )

    lang_prob = getattr(info, 'language_probability', None)
    if lang_prob is not None:
        print(f'Detected language: {info.language} (prob: {lang_prob:.2f})', file=sys.stderr)
    else:
        print(f'Detected language: {info.language}', file=sys.stderr)
    print(f'Duration: {info.duration:.1f}s', file=sys.stderr)

    transcript = ' '.join(s.text.strip() for s in segments)
    print(transcript)


if __name__ == '__main__':
    main()
