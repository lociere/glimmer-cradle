// multimodal related types

export type ModalityType = "text" | "image" | "video";

export interface ModelInputSemantic {
    text: string;
    source?: string;
    resolved?: boolean;
    confidence?: number;
}

export interface ModelInputItem {
    modality: ModalityType;
    text?: string;
    uri?: string;
    mime_type?: string;
    semantic?: ModelInputSemantic;
    metadata?: Record<string, unknown>;
}

export interface ModelInput {
    items: ModelInputItem[];
}
