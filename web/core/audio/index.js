// Звуковая часть ядра FormatBox: все экспорты одним модулем (для окна и Worker).
export { decodeWav, encodeWav, readWavHeader } from './wav.js';
export { convertPcm, resample, remapChannels, quantize } from './convert.js';
export { chipify, chipParams, CHIP_PRESETS } from './chip.js';
export { trackPitch, detectNotes, detectOnsets, estimateTempo, onsetEnvelope } from './pitch.js';
export { renderChannels, renderChannel, noiseSequence, nesFrequency, envelopeLevel, songLength, DUTIES, NOISE_PERIODS, CPU_HZ } from './synth.js';
export { transcribe, renderChip, foldBass, PREVIEW_SECONDS } from './remix.js';
export { mixdown, midiToHz, hzToMidi, filter } from './util.js';
