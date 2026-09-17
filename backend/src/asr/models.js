/**
 * 实测可用的语音识别模型清单。
 *
 * 数据来源：backend/scripts/probe-models.mjs 用同一段中文语音逐个打过接口。
 * 只收「返回 200 且文字正确」的。改动前请先跑 npm run probe:models。
 *
 * 排除说明：
 * - FunAudioLLM/SenseVoiceSmall、iic/SenseVoiceSmall：请求挂死不回包。
 * - openai/whisper-large-v3、Qwen/Qwen3-ASR-Flash：这家没有这个模型。
 * - XingChenAGI/XingChenASR-Diarize-V3.0：可用，但会返回「1: xx / 2: xx」的说话人编号，
 *   会把字幕行弄乱，所以不放进选项。
 */

export const ASR_MODELS = [
  {
    id: 'Qwen/Qwen3-ASR-1.7B',
    label: 'Qwen3-ASR 1.7B（最快，约 0.4 秒）',
    latencyMs: 355,
  },
  {
    id: 'XingChenAGI/XingChenASR-V3.2-Ultra',
    label: '星辰 ASR V3.2 Ultra（约 1.2 秒）',
    latencyMs: 1196,
  },
  {
    id: 'TeleAI/TeleSpeechASR',
    label: 'TeleSpeech ASR（约 1.6 秒）',
    latencyMs: 1646,
  },
  {
    id: 'XingChenAGI/XingChenASR-V3.2',
    label: '星辰 ASR V3.2（约 1.7 秒）',
    latencyMs: 1673,
  },
];

/** 只允许清单里的模型，防止前端传个挂死的模型进来。 */
export function resolveModel(requested, fallback) {
  const wanted = String(requested || '').trim();
  if (wanted && ASR_MODELS.some((m) => m.id === wanted)) return wanted;
  return fallback;
}
