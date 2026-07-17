// emotion related types

export type Emotion = 'happy' | 'sad' | 'angry' | 'neutral';

export interface EmotionState {
  emotion_type: Emotion | string;
  intensity: number;
  trigger: string;
  timestamp: string;
}
