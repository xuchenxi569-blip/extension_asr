/**
 * 把 16kHz 单声道 PCM (Int16) 拼成 WAV，方便发给兼容 Whisper 的接口。
 */

export function pcm16ToWavBuffer(pcmChunks, sampleRate = 16000) {
  const pcm = Buffer.concat(pcmChunks.map((chunk) => Buffer.from(chunk)));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
