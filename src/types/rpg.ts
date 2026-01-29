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
  
  // Novos campos para banner e level
  has_level_system?: boolean;
  max_levels?: number;
  challenge_banner_url?: string;
  
}

export interface TeamMember {
  name: string;
  base_hp: number;
  skills?: CharacterSkill[];
  
  // Campos de nivel e parceiro
  current_level?: number; 
  has_life?: boolean;
  life_type?: 'numeric' | 'hit';
  has_level_system?: boolean;
  max_levels?: number;
  evolutions?: any[]; // Pode tipar melhor se quiser, mas any resolve por enquanto
}

export interface TeamMemberState {
  name: string;
  current_hp: number;
  max_hp: number;
  current_level?: number;
}

export interface CharacterSkill {
  id: string;
  character_id?: string;
  name: string;
  description: string;
  type: 'active' | 'passive' | 'transformation';
  cost?: string;
  damage?: string;
  cooldown?: number;
  
  // Campos avançados
  passive_type?: 'individual' | 'general' | 'transformed' | 'general_transformed';
  active_type?: 'individual' | 'general' | 'transformed'; 
  duration?: number; // -1 = infinito
  shield_value?: number;
  
  // Level system
  unlock_level?: number;
  
  // Hit system
  is_hit_based?: boolean;
  hit_value?: number;
  combat_state?: 'normal' | 'boss';
}

export interface ActiveTransformation {
  name: string;
  rounds_left: number; // -1 = infinito
}

export interface ActiveStatusEffect {
  name: string;
  description?: string;
  damage?: string | null;
  duration: number; 
}

// --- ATUALIZAÇÃO IMPORTANTE AQUI ---
export interface GameEvent {
  id: string;
  title: string;
  description: string;
  image_url?: string;
  created_at?: string;
  
  // ADICIONADO:
  event_characters?: EventCharacter[];
  enemy_name?: string;
  base_hp?: number;
  boss_skills?: BossSkill[];
  // has_life?: boolean;
  // is_boss?: boolean;
  is_faction_event?: boolean; // Flag para saber se é esse modo
    factions?: Faction[];
}

export interface EventCharacter {
    name: string;
    base_hp: number;
    has_life: boolean;
    is_boss: boolean; // Flag para destacar visualmente
    skills: CharacterSkill[]; // Reutiliza a estrutura de skills (Ativas/Passivas)
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
  event_state?: any; // Pode tipar como EventState se mover a interface para cá, ou manter any por compatibilidade
  
  // ADICIONADO:
  // event_state?: {
  //     current_hp: number;
  //     max_hp: number;
  //     name: string;
  //     image_url?: string;
  //     boss_skills?: BossSkill[];
  //     has_life?: boolean;
  //     is_boss?: boolean;
  // };
  
}

export interface RoomParticipant {
  id: string;
  room_code: string;
  user_id: string;
  user_email?: string;
  username?: string;
  selected_character_id?: string;
  is_ready: boolean;
  
  // Status em jogo
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

  // Level System
  current_level?: number;

  // Controle de Estado HIT
  pre_transformation_hp?: number | null;
  
  // Desafio
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
    target: 'players_global' | 'self'; // 'players_global' = Ruim para todos, 'self' = Bom para o boss
}

export interface Faction {
    id: string;
    name: string;
    skill: CharacterSkill; // A skill que define a aura da facção
}