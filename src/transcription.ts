import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { logger } from './logger.js';

const execAsync = promisify(exec);

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_WHISPER_VENV = path.join(PROJECT_ROOT, 'data', 'whisper-venv');
const TRANSCRIBE_SCRIPT = path.join(PROJECT_ROOT, 'bin', 'transcribe.py');

async function transcribeWithLocalWhisper(
  audioBuffer: Buffer,
  msgId: string,
): Promise<string | null> {
  const venvPath = process.env.WHISPER_VENV_PATH ?? DEFAULT_WHISPER_VENV;
  const pythonBin = path.join(venvPath, 'bin', 'python');

  if (!fs.existsSync(pythonBin)) {
    logger.warn(
      { venvPath },
      'Whisper venv not found — voice transcription disabled',
    );
    return null;
  }

  const tmpFile = path.join(os.tmpdir(), `nanoclaw-voice-${msgId}.ogg`);
  try {
    fs.writeFileSync(tmpFile, audioBuffer);
    const model = process.env.WHISPER_MODEL ?? 'medium';
    const { stdout } = await execAsync(
      `"${pythonBin}" "${TRANSCRIBE_SCRIPT}" "${tmpFile}" --model "${model}"`,
      { timeout: 120_000 },
    );
    return stdout.trim() || null;
  } catch (err) {
    logger.warn({ err }, 'Voice transcription failed');
    return null;
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

export async function transcribeAudioMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<string | null> {
  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      logger.error('Failed to download audio message');
      return '[Voice Message - transcription unavailable]';
    }

    const msgId = msg.key.id ?? Date.now().toString();
    const transcript = await transcribeWithLocalWhisper(buffer, msgId);

    if (!transcript) {
      return '[Voice Message - transcription unavailable]';
    }

    logger.info({ chars: transcript.length }, 'Transcribed voice message');
    return transcript;
  } catch (err) {
    logger.error({ err }, 'Transcription error');
    return '[Voice Message - transcription unavailable]';
  }
}

export function isVoiceMessage(msg: WAMessage): boolean {
  // ptt=true for recorded voice notes; ptt=false/undefined for forwarded audio.
  // Treat any audioMessage as a voice note so forwarded voice notes are transcribed.
  return !!msg.message?.audioMessage;
}
