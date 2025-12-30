// src/types/rpg.ts

export interface Character {
  id: string;
  name: string;
  rpg_class: string;
  level: number;
}

export interface GameCharacter {
  id: string;
  name: string;
  anime_origin: string;
  base_class: string;
  image_url?: string;
  created_by?: string;
  base_hp: number;
}

export interface UserRosterItem {
  id: string;
  current_level: number;
  game_characters: GameCharacter;
}

export interface Victory {
  id: string;
  character_name: string;
  session_name: string;
  victory_date: string;
}

export interface GameEvent {
  id: string;
  title: string;
  description: string;
  image_url?: string;
}

export interface Room {
  code: string;
  host_id: string;
  status: 'waiting' | 'selecting' | 'playing';
  selected_event_id?: string;
  current_turn_participant_id?: string; // O erro vermelho some aqui
}

export interface RoomParticipant {
  id: string;
  room_code: string;
  user_id: string;
  user_email: string;
  username: string;
  selected_character_id?: string;
  is_ready: boolean;
  current_hp: number;
  max_hp: number;
  buffs?: string;
  debuffs?: string;
  turn_order?: number;
}

// src/types/rpg.ts
// ... (mantenha o resto igual)

export interface CharacterSkill {
  id: string;
  character_id: string;
  name: string;
  description: string;
  type: 'active' | 'passive' | 'transformation';
  cost?: string;
}

export interface CharacterSkill {
  id: string;
  character_id: string;
  name: string;
  description: string;
  type: 'active' | 'passive' | 'transformation';
  cost?: string;
  duration?: number; // <--- NOVO: Duração padrão em rodadas
}

// Estrutura do objeto dentro do JSON de transformações ativas
export interface ActiveTransformation {
  name: string;
  rounds_left: number;
}

export interface StatusEffect {
  id: string;
  title: string;
  description: string;
  type: 'buff' | 'debuff';
  damage?: string;
  duration?: number;
}

export interface ActiveStatusEffect {
  name: string;
  description?: string;
  damage?: string;  // Ex: "10", "5"
  duration: number; // Rodadas restantes
}

export interface RoomParticipant {
  id: string;
  room_code: string;
  user_id: string;
  user_email: string;
  username: string;
  selected_character_id?: string;
  is_ready: boolean;
  current_hp: number;
  max_hp: number;
  buffs?: string;   // (Pode manter por compatibilidade, mas vamos usar os novos)
  debuffs?: string; // (Pode manter por compatibilidade, mas vamos usar os novos)
  active_buffs?: ActiveStatusEffect[];   // <--- NOVO
  active_debuffs?: ActiveStatusEffect[]; // <--- NOVO
  turn_order?: number;
  active_transformations?: ActiveTransformation[];
}

