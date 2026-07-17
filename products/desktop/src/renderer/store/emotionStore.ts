import { create } from 'zustand';

export interface EmotionParams {
  eyeOpenness: number;
  mouthForm: number;
  blushLevel: number;
  motionGroup: string;
}

export interface EmotionUpdate {
  emotion_type: string;
  intensity: number;
  trigger: string;
  timestamp: string;
}

const EMOTION_ALIAS_MAP: Record<string, string> = {
  calm: 'neutral',
  neutral: 'neutral',
  happy: 'happy',
  joyful: 'happy',
  pleased: 'happy',
  excited: 'happy',
  shy: 'shy',
  coy: 'shy',
  tsundere: 'shy',
  angry: 'angry',
  furious: 'angry',
  sad: 'sad',
  aggrieved: 'sad',
  worried: 'sad',
  sulky: 'sad',
  thinking: 'thinking',
  curious: 'thinking',
  '平静': 'neutral',
  '开心': 'happy',
  '高兴': 'happy',
  '愉快': 'happy',
  '兴奋': 'happy',
  '害羞': 'shy',
  '撒娇': 'shy',
  '傲娇': 'shy',
  '生气': 'angry',
  '愤怒': 'angry',
  '难过': 'sad',
  '委屈': 'sad',
  '无奈': 'sad',
  '思考': 'thinking',
  '疑惑': 'thinking',
  '好奇': 'thinking',
};

const EMOTION_PARAM_MAP: Record<string, Partial<EmotionParams>> = {
  happy: { eyeOpenness: 1.0, mouthForm: 0.8, blushLevel: 0.2, motionGroup: 'happy' },
  sad: { eyeOpenness: 0.5, mouthForm: 0.2, blushLevel: 0, motionGroup: 'sad' },
  angry: { eyeOpenness: 0.9, mouthForm: 0.3, blushLevel: 0.5, motionGroup: 'angry' },
  shy: { eyeOpenness: 0.75, mouthForm: 0.65, blushLevel: 0.75, motionGroup: 'shy' },
  thinking: { eyeOpenness: 0.7, mouthForm: 0.35, blushLevel: 0.05, motionGroup: 'thinking' },
  neutral: { eyeOpenness: 0.8, mouthForm: 0.5, blushLevel: 0, motionGroup: 'idle' },
};

const DEFAULT_PARAMS: EmotionParams = {
  eyeOpenness: 0.8,
  mouthForm: 0.5,
  blushLevel: 0,
  motionGroup: 'idle',
};

interface EmotionState {
  params: EmotionParams;
  lastEmotion: EmotionUpdate | null;
  updateEmotion: (emotion: EmotionUpdate) => void;
  resetEmotion: () => void;
}

export const useEmotionStore = create<EmotionState>((set) => ({
  params: { ...DEFAULT_PARAMS },
  lastEmotion: null,

  updateEmotion: (emotion: EmotionUpdate) => {
    const normalizedType = EMOTION_ALIAS_MAP[emotion.emotion_type] ?? 'neutral';
    const mapped = EMOTION_PARAM_MAP[normalizedType];
    const base = DEFAULT_PARAMS;
    const newParams: EmotionParams = mapped
      ? {
          eyeOpenness: base.eyeOpenness + ((mapped.eyeOpenness ?? base.eyeOpenness) - base.eyeOpenness) * emotion.intensity,
          mouthForm: base.mouthForm + ((mapped.mouthForm ?? base.mouthForm) - base.mouthForm) * emotion.intensity,
          blushLevel: (mapped.blushLevel ?? 0) * emotion.intensity,
          motionGroup: mapped.motionGroup ?? 'idle',
        }
      : { ...base };

    set({
      params: newParams,
      lastEmotion: {
        ...emotion,
        emotion_type: normalizedType,
      },
    });
  },

  resetEmotion: () => set({ params: { ...DEFAULT_PARAMS }, lastEmotion: null }),
}));
