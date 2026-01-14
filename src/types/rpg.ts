// src/types/rpg.ts

export interface Character {
  id: string;
  name: string;
  rpg_class: string;
  level: number;
}

// Membro da equipe (Catálogo/Criação)
export interface TeamMember {
  name: string;
  base_hp: number;
}

// Estado do membro durante a partida (Vida dinâmica)
export interface TeamMemberState {
  name: string;
  current_hp: number;
  max_hp: number;
}

export interface GameCharacter {
  id: string;
  name: string;
  anime_origin: string;
  base_class: string;
  image_url?: string;
  created_by?: string;
  base_hp: number;
  
  // Novos campos para Categorias e Equipe
  category?: 'individual' | 'equipe' | 'hit';
  unit_count?: number; 
  team_members?: TeamMember[]; 
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
  current_turn_participant_id?: string;
  
  // Controle de Fases
  turn_phase?: 'initial' | 'main' | 'end'; 
}

export interface CharacterSkill {
  id: string;
  character_id: string;
  name: string;
  description: string;
  type: 'active' | 'passive' | 'transformation';
  cost?: string;
  duration?: number; 
}

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
  
  // Status Principal
  current_hp: number;
  max_hp: number;
  
  // Efeitos (Legado e Novo Sistema)
  buffs?: string;   
  debuffs?: string; 
  active_buffs?: ActiveStatusEffect[];   
  active_debuffs?: ActiveStatusEffect[]; 
  active_transformations?: ActiveTransformation[];

  turn_order?: number;

  // Estado da Equipe em Jogo
  team_state?: TeamMemberState[]; 
  active_member_name?: string; // Nome do membro que está lutando agora
}