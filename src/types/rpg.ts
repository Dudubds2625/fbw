// src/types/rpg.ts

export interface GameCharacter {
  id: string;
  name: string;
  anime_origin: string;
  base_class: string;
  image_url?: string;
  created_at?: string;
  base_hp: number;
  category: 'individual' | 'equipe' | 'hit';
  unit_count: number;
  base_shield?: number;
  team_members?: TeamMember[];
  
  has_level_system?: boolean;
  max_levels?: number;
  challenge_banner_url?: string;
}

export interface TeamMember {
  name: string;
  base_hp: number;
  skills?: CharacterSkill[];
  
  current_level?: number; 
  has_life?: boolean;
  life_type?: 'numeric' | 'hit';
  has_level_system?: boolean;
  max_levels?: number;
  evolutions?: any[];
}

export interface PartnerMember extends TeamMember {
  has_life: boolean;
  life_type: 'numeric' | 'hit';
  has_level_system?: boolean;
  max_levels?: number;
}

export interface TeamMemberState {
  name: string;
  current_hp: number;
  max_hp: number;
  current_level?: number;
}

// --- AQUI ESTÁ A CORREÇÃO PRINCIPAL ---
export interface CharacterSkill {
  id: string;
  character_id?: string;
  name: string;
  description: string;
  
  // ADICIONEI 'summon' AQUI:
  type: 'active' | 'passive' | 'transformation' | 'summon';
  
  cost?: string;
  damage?: string;
  cooldown?: number;
  
  passive_type?: 'individual' | 'general' | 'transformed' | 'general_transformed';
  active_type?: 'individual' | 'general' | 'transformed'; 
  
  duration?: number;
  shield_value?: number;
  unlock_level?: number;
  is_hit_based?: boolean;
  hit_value?: number;
  combat_state?: 'normal' | 'boss';

  // Campo para guardar o nome do alvo da invocação
  summon_target_name?: string; 
}

export interface ActiveTransformation {
  name: string;
  rounds_left: number;
}

export interface ActiveStatusEffect {
  name: string;
  description?: string;
  damage?: string | null;
  duration: number; 
}

// Atualização para itens e passivas globais
export interface EventItem {
  id: string;
  name: string;
  description: string;
  damage: string;
  has_ammo: boolean;
  ammo_count: number;
}

export interface GameEvent {
  id: string;
  title: string;
  description: string;
  image_url?: string;
  created_at?: string;
  
  event_characters?: EventCharacter[];
  enemy_name?: string;
  base_hp?: number;
  boss_skills?: BossSkill[];
  is_faction_event?: boolean; 
  factions?: Faction[];
  
  // Campos novos
  items?: EventItem[];
  passives?: CharacterSkill[];
  has_three_units_boss_rule?: boolean;
}

export interface EventCharacter {
    name: string;
    base_hp: number;
    has_life: boolean;
    is_boss: boolean;
    skills: CharacterSkill[];
    // Campo novo
    becomes_boss_on_condition?: boolean;
    starts_on_board?: boolean;
}

export interface Room {
  id: string;
  code: string;
  host_id: string;
  status: 'waiting' | 'selecting' | 'playing' | 'finished';
  created_at: string;
  current_turn_participant_id?: string;
  turn_phase?: 'initial' | 'main' | 'end';
  selected_event_id?: string;
  event_state?: any; 
}

export interface RoomParticipant {
  id: string;
  room_code: string;
  user_id: string;
  user_email?: string;
  username?: string;
  selected_character_id?: string;
  is_ready: boolean;
  
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

  current_level?: number;
  pre_transformation_hp?: number | null;
  challenge_completed?: boolean;
  assigned_faction_id?: string;
}

export interface UserRosterItem {
  id: string;
  user_id: string;
  character_id: string;
  current_level: number;
  experience?: number;
  acquired_at: string;
  game_characters?: GameCharacter;
  challenge_completed?: boolean;
}

export interface StatusEffect {
  id: string;
  title: string;
  description: string;
  type: 'buff' | 'debuff';
  damage?: string;
  duration?: number;
}

export interface Victory {
  id: string;
  user_id: string;
  character_name: string;
  session_name: string;
  victory_date: string;
}

export interface MatchHistoryItem {
  id: string;
  room_code: string;
  winner_name: string;
  winner_character: string;
  played_at: string;
  duration_seconds: number;
  participants_snapshot: any; 
}

export interface BossSkill {
    name: string;
    description: string;
    target: 'players_global' | 'self';
}

export interface Faction {
    id: string;
    name: string;
    skill: CharacterSkill;
}