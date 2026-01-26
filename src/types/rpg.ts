// src/types/rpg.ts

export interface CharacterSkill {
  id: string; 
  character_id?: string;
  name: string;
  description: string;
  type: 'active' | 'passive' | 'transformation';
  
  // SUBTIPOS
  passive_type?: 'general' | 'individual' | 'transformed'; 
  active_type?: 'general' | 'individual' | 'transformed'; // <--- NOVO CAMPO

  cost?: string;
  duration?: number;
  shield_value?: number;
}

export interface TeamMember {
  name: string;
  base_hp: number;
  skills?: CharacterSkill[]; 
}

export interface GameCharacter {
  id: string;
  name: string;
  anime_origin: string;
  base_class: string;
  image_url?: string;
  challenge_banner_url?: string;
  created_by?: string;
  base_hp: number;
  category?: 'individual' | 'equipe' | 'hit';
  unit_count?: number; 
  team_members?: TeamMember[]; 
  base_shield?: number;
}

export interface Victory {
  id: string;
  user_id: string;
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

export interface StatusEffect {
  id: string;
  title: string;
  description: string;
  type: 'buff' | 'debuff';
  damage?: string;
  duration?: number;
}

export interface ActiveTransformation {
  name: string;
  rounds_left: number;
}

export interface ActiveStatusEffect {
  name: string;
  description: string;
  damage?: string;
  duration: number;
}

export interface TeamMemberState {
  name: string;
  current_hp: number;
  max_hp: number;
}

export interface MatchHistoryItem {
  id: string;
  room_code: string;
  winner_name: string;
  winner_character: string;
  duration_seconds: number;
  played_at: string;
  participants_snapshot: any[];
}

export interface Room {
  id: string;
  code: string;
  host_id: string;
  status: 'waiting' | 'selecting' | 'playing' | 'finished';
  created_at: string;
  selected_event_id?: string;
  current_turn_participant_id?: string;
  turn_phase?: 'initial' | 'main' | 'end';
}

export interface RoomParticipant {
  id: string;
  room_code: string;
  user_id: string;
  user_email: string;
  username: string;
  is_ready: boolean;
  selected_character_id?: string;
  current_hp: number;
  max_hp: number;
  current_shield?: number;
  turn_order?: number;
  active_transformations?: ActiveTransformation[];
  active_buffs?: ActiveStatusEffect[];
  active_debuffs?: ActiveStatusEffect[];
  buffs?: string;
  debuffs?: string;
  team_state?: TeamMemberState[];
  active_member_name?: string;
  challenge_completed?: boolean;
}

export interface UserRosterItem {
  id: string;
  user_id: string;
  character_id: string;
  current_level: number;
  acquired_at: string;
  challenge_completed?: boolean;
  game_characters?: GameCharacter;
}