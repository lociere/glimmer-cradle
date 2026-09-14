export interface UserSkillDocument {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

export interface UserSkillSourcePort {
  load(): Promise<{ readonly enabled: boolean; readonly skills: readonly UserSkillDocument[]; readonly errors: readonly string[] }>;
}
