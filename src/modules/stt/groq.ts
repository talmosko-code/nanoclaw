/**
 * Groq Whisper STT (Speech-to-Text) for NanoClaw.
 * 
 * Transcribes voice/audio messages using Groq's Whisper API.
 * Groq Free Tier: 30 RPS (requests per second) - plenty for voice notes.
 */
import { log } from '../../log.js';
import { GROQ_API_KEY } from '../../config.js';

const DEFAULT_MODEL = 'whisper-large-v3';

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface GroqSttConfig {
  model?: string;
  language?: string; // 'he' for Hebrew, 'auto' for auto-detect
}

/**
 * Transcribe audio data using Groq Whisper API.
 * Uses GROQ_API_KEY from environment (set in .env or process.env).
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  config: GroqSttConfig
): Promise<TranscriptionResult> {
  const { model = DEFAULT_MODEL, language } = config;
  const apiKey = GROQ_API_KEY;

  if (!apiKey) {
    throw new Error('GROQ_API_KEY not set in environment');
  }

  // Determine file extension from mime type  
  const extension = mimeTypeToExtension(mimeType);
  const filename = `audio.${extension}`;

  // Build form data
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), filename);
  formData.append('model', model);
  
  if (language && language !== 'auto') {
    formData.append('language', language);
  }

  log.info('Sending audio to Groq Whisper API', { 
    size: audioBuffer.length, 
    mimeType, 
    model,
    language: language || 'auto'
  });

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error('Groq STT failed', { status: response.status, error: errorText });
    throw new Error(`Groq STT failed: ${response.status} ${errorText}`);
  }

  const result = await response.json() as {
    text: string;
    language?: string;
    duration?: number;
  };

  log.info('Groq STT success', { 
    textLength: result.text?.length || 0,
    language: result.language,
    duration: result.duration
  });

  return {
    text: result.text || '',
    language: result.language,
    duration: result.duration,
  };
}

/**
 * Check if an attachment is a voice/audio file that should be transcribed
 */
export function isTranscribableAudio(mimeType: string): boolean {
  const audioTypes = [
    'audio/ogg',
    'audio/mpeg',
    'audio/wav',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/flac',
    'audio/x-m4a',
  ];
  return audioTypes.some(type => mimeType.startsWith(type));
}

/**
 * Convert MIME type to file extension
 */
function mimeTypeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/x-m4a': 'm4a',
  };
  
  for (const [type, ext] of Object.entries(map)) {
    if (mimeType.startsWith(type)) return ext;
  }
  
  return 'bin';
}

/**
 * Get Groq API key from OneCLI vault.
 * Uses the host's OneCLI credentials to fetch secrets.
 */
export async function getGroqGatewayUrl(): Promise<string | null> {
  const ONECLI_URL = process.env.ONECLI_URL || 'http://127.0.0.1:10254';
  const gatewayUrl = ONECLI_URL.replace(':10254', ':10255');
  
  // Verify gateway is reachable
  try {
    const res = await fetch(gatewayUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    if (res.status === 400 || res.status === 200) {
      // 400 is expected (bad request on /), means gateway is alive
      return gatewayUrl;
    }
  } catch {
    log.warn('OneCLI gateway not reachable', { gatewayUrl });
    return null;
  }
  
  return gatewayUrl;
}
