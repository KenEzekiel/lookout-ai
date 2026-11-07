import { mkdir, writeFile } from "node:fs/promises";

const sampleRate = 44100;
const duration = 1.2;
const frames = Math.round(sampleRate * duration);
const wav = Buffer.alloc(44 + frames * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(frames * 2, 40);
for (let frame = 0; frame < frames; frame++) {
  const time = frame / sampleRate;
  const pulse = Math.floor(time / 0.4);
  const local = time - pulse * 0.4;
  const envelope = Math.max(0, Math.min(local / 0.008, 1, (0.28 - local) / 0.018));
  const phase = 2 * Math.PI * (960 * Math.min(local, 0.14) + 720 * Math.max(0, local - 0.14));
  const tone = Math.sin(phase) + 0.3 * Math.sin(3 * phase) + 0.12 * Math.sin(5 * phase);
  wav.writeInt16LE(Math.round(0.32 * envelope * tone * 32767), 44 + frame * 2);
}
const destination = new URL("../apps/app/public/sounds/incident-alert.wav", import.meta.url);
await mkdir(new URL(".", destination), { recursive: true });
await writeFile(destination, wav);
