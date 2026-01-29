import React, { useEffect, useState, useCallback, useRef } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ScrollView, 
  RefreshControl, Alert, Modal, FlatList, TextInput, Image, KeyboardAvoidingView, Platform, ActivityIndicator 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { UserRosterItem, GameCharacter, Victory, GameEvent, Room, RoomParticipant, CharacterSkill, StatusEffect, TeamMember, MatchHistoryItem, BossSkill, EventCharacter } from '../types/rpg';
import { Ionicons } from '@expo/vector-icons'; 
import { RealtimeChannel } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker'; 
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer'; 

interface HomeScreenProps {
  onStartGame: (roomCode: string) => void;
}

// --- INTERFACES LOCAIS ---
interface BossSkillLocal {
    name: string;
    description: string;
    target: 'players_global' | 'self';
}

interface PartnerMember extends TeamMember {
  has_life: boolean;
  life_type: 'numeric' | 'hit';
  has_level_system?: boolean;
  max_levels?: number;
}

interface GameCharacterWithCreator extends GameCharacter { 
  created_by?: string; 
  challenge_banner_url?: string; 
}

const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

export default function HomeScreen({ onStartGame }: HomeScreenProps) {
  // ==================================================================================
  // 1. STATES GERAIS
  // ==================================================================================
  const [playedCharacters, setPlayedCharacters] = useState<UserRosterItem[]>([]);
  const [catalogChars, setCatalogChars] = useState<GameCharacterWithCreator[]>([]);
  const [catalogEvents, setCatalogEvents] = useState<GameEvent[]>([]);
  const [catalogEffects, setCatalogEffects] = useState<StatusEffect[]>([]); 
  const [victories, setVictories] = useState<Victory[]>([]);
  const [matchHistory, setMatchHistory] = useState<MatchHistoryItem[]>([]);
  
  // UI & Auth
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [selectedCharStats, setSelectedCharStats] = useState({ matches: 0, wins: 0, winRate: 0, missions: 0 });
  const [loadingStats, setLoadingStats] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [username, setUsername] = useState(''); 
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Sala (Room)
  const [lobbyModalVisible, setLobbyModalVisible] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [joinCode, setJoinCode] = useState(''); 
  const roomChannelRef = useRef<RealtimeChannel | null>(null);
  
  // --- NOVO: SELEÇÃO DE EVENTO NO LOBBY ---
  const [eventSelectionMode, setEventSelectionMode] = useState<'random' | 'manual'>('random');
  const [lobbySelectedEventId, setLobbySelectedEventId] = useState<string | null>(null);

  // Visibilidade dos Modais
  const [createCharModalVisible, setCreateCharModalVisible] = useState(false);
  const [manageEventsModalVisible, setManageEventsModalVisible] = useState(false);
  const [createEventModalVisible, setCreateEventModalVisible] = useState(false);
  const [manageEffectsModalVisible, setManageEffectsModalVisible] = useState(false);
  const [createEffectModalVisible, setCreateEffectModalVisible] = useState(false);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<UserRosterItem | null>(null);
  const [memberSkillsModalVisible, setMemberSkillsModalVisible] = useState(false);
  
  // Char Creation Form
  const [editingCharId, setEditingCharId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newOrigin, setNewOrigin] = useState('');
  const [newClass, setNewClass] = useState('');
  const [newCategory, setNewCategory] = useState<'individual' | 'equipe' | 'hit'>('individual');
  const [hpInput1, setHpInput1] = useState('10'); 
  const [hasShield, setHasShield] = useState(false);
  const [shieldInput, setShieldInput] = useState('0');
  const [hasLevelSystem, setHasLevelSystem] = useState(false);
  const [maxLevelsInput, setMaxLevelsInput] = useState('');
  const [newImage, setNewImage] = useState(''); 
  const [pickedImageUri, setPickedImageUri] = useState(''); 
  const [newBanner, setNewBanner] = useState('');
  const [pickedBannerUri, setPickedBannerUri] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);

  // Team Form
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [currentMemberIndex, setCurrentMemberIndex] = useState<number | null>(null);
  const [memberName, setMemberName] = useState('');
  const [memberHp, setMemberHp] = useState('');

  // Parceiros
  const [hasPartners, setHasPartners] = useState(false);
  const [partners, setPartners] = useState<PartnerMember[]>([]);
  const [partnerModalVisible, setPartnerModalVisible] = useState(false);
  const [editingPartnerIndex, setEditingPartnerIndex] = useState<number | null>(null);
  const [partnerName, setPartnerName] = useState('');
  const [partnerHasLife, setPartnerHasLife] = useState(true);
  const [partnerLifeType, setPartnerLifeType] = useState<'numeric' | 'hit'>('numeric');
  const [partnerHpInput, setPartnerHpInput] = useState('10');
  const [partnerHasLevelSystem, setPartnerHasLevelSystem] = useState(false);
  const [partnerMaxLevelsInput, setPartnerMaxLevelsInput] = useState('');
  const [partnerSkills, setPartnerSkills] = useState<CharacterSkill[]>([]);
  const [editingPartnerSkillIndex, setEditingPartnerSkillIndex] = useState<number | null>(null);

  // Skills (Genérico para Char e Parceiros)
  const [tempSkills, setTempSkills] = useState<Partial<CharacterSkill>[]>([]);
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillCost, setSkillCost] = useState('');
  const [skillDuration, setSkillDuration] = useState(''); 
  const [skillType, setSkillType] = useState<'active' | 'passive' | 'transformation'>('active');
  const [skillGeneratesShield, setSkillGeneratesShield] = useState(false);
  const [skillShieldValue, setSkillShieldValue] = useState('');
  const [skillIsHitBased, setSkillIsHitBased] = useState(false);
  const [skillHitValueInput, setSkillHitValueInput] = useState('');
  const [passiveCondition, setPassiveCondition] = useState<'normal' | 'transformed'>('normal');
  const [activeCondition, setActiveCondition] = useState<'normal' | 'transformed'>('normal');
  const [isSkillGeneral, setIsSkillGeneral] = useState(false);
  const [editingSkillIndex, setEditingSkillIndex] = useState<number | null>(null);
  const [skillUnlockLevel, setSkillUnlockLevel] = useState('1');

  // --- STATE PARA FASE DE COMBATE DA SKILL DO BOSS ---
  const [skillCombatState, setSkillCombatState] = useState<'normal' | 'boss'>('normal');

  // ==================================================================================
  // 3. STATES DE EVENTOS
  // ==================================================================================
  
  // Evento Principal
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventImage, setNewEventImage] = useState('');
  const [pickedEventImageUri, setPickedEventImageUri] = useState('');
  
  // Lista de Personagens do Evento
  const [eventCharacters, setEventCharacters] = useState<EventCharacter[]>([]);
  
  // Controle do Sub-Modal de Personagem do Evento
  const [createEventCharModalVisible, setCreateEventCharModalVisible] = useState(false);
  const [editingEventCharIndex, setEditingEventCharIndex] = useState<number | null>(null);
  
  // Form do Personagem do Evento
  const [evCharName, setEvCharName] = useState('');
  const [evCharHp, setEvCharHp] = useState('10');
  const [evCharHasLife, setEvCharHasLife] = useState(true);
  const [evCharIsBoss, setEvCharIsBoss] = useState(false); // Checkbox Boss
  
  // Skills do Personagem do Evento
  const [evCharSkills, setEvCharSkills] = useState<CharacterSkill[]>([]); 
  const [editingEvCharSkillIndex, setEditingEvCharSkillIndex] = useState<number | null>(null);
  
  // Skills de Boss (Passivas Globais - Específicas para Bosses)
  const [bossSkills, setBossSkills] = useState<BossSkillLocal[]>([]);
  const [bossSkillName, setBossSkillName] = useState('');
  const [bossSkillDesc, setBossSkillDesc] = useState('');
  const [bossSkillTarget, setBossSkillTarget] = useState<'players_global' | 'self'>('players_global');
  const [editingBossSkillIndex, setEditingBossSkillIndex] = useState<number | null>(null);
  
  // Dados do Evento Antigo
  const [newEventEnemyName, setNewEventEnemyName] = useState('');
  const [newEventEnemyHp, setNewEventEnemyHp] = useState('');
  const [newEventHasLife, setNewEventHasLife] = useState(true);
  const [newEventIsBoss, setNewEventIsBoss] = useState(false);

  // Efeitos
  const [editingEffectId, setEditingEffectId] = useState<string | null>(null);
  const [effectTitle, setEffectTitle] = useState('');
  const [effectDesc, setEffectDesc] = useState('');
  const [effectType, setEffectType] = useState<'buff' | 'debuff'>('buff');
  const [effectDamage, setEffectDamage] = useState('');
  const [effectDuration, setEffectDuration] = useState('');

  // ==================================================================================
  // 4. HELPERS VISUAIS
  // ==================================================================================
  const getCategoryColor = (cat?: string) => { switch(cat) { case 'equipe': return '#FFD700'; case 'hit': return '#ff4444'; default: return '#00B37E'; } };
  const getSubtypeLabel = (type?: string) => { switch(type) { case 'general': return 'GERAL'; case 'general_transformed': return 'GERAL (TRANSF)'; case 'transformed': return 'TRANSF.'; default: return 'INDIV.'; } };
  const getSubtypeColor = (type?: string) => { switch(type) { case 'general': return '#00B37E'; case 'general_transformed': return '#FF4444'; case 'transformed': return '#ff8800'; default: return '#8257e5'; } };
  
  const clearSkillForm = () => { 
      setSkillName(''); setSkillDesc(''); setSkillCost(''); setSkillDuration(''); setSkillShieldValue(''); setSkillGeneratesShield(false); setSkillType('active'); setPassiveCondition('normal'); setActiveCondition('normal'); setIsSkillGeneral(false); setEditingSkillIndex(null); setSkillUnlockLevel('1'); setSkillIsHitBased(false); setSkillHitValueInput(''); 
      setSkillCombatState('normal'); 
  };

  // ==================================================================================
  // 5. DATA & AUTH
  // ==================================================================================
  const fetchParticipants = async (code: string) => { const { data } = await supabase.from('room_participants').select('*').eq('room_code', code); if (data) setParticipants(data); };
  const subscribeToRoom = (roomCode: string) => { if (roomChannelRef.current) supabase.removeChannel(roomChannelRef.current); const channel = supabase.channel(`room_${roomCode}`).on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` }, (payload) => { const updatedRoom = payload.new as Room; setCurrentRoom(updatedRoom); if (updatedRoom.status === 'playing') { setLobbyModalVisible(false); onStartGame(roomCode); } }).on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_code=eq.${roomCode}` }, () => fetchParticipants(roomCode)).subscribe(); roomChannelRef.current = channel; };
  const fetchCatalogs = async () => { const { data: chars } = await supabase.from('game_characters').select('*').order('name'); if (chars) setCatalogChars(chars); const { data: events } = await supabase.from('game_events').select('*').order('title'); if (events) setCatalogEvents(events); const { data: effects } = await supabase.from('game_status_effects').select('*').order('title'); if (effects) setCatalogEffects(effects); };
  
  const fetchData = useCallback(async () => { try { setLoading(true); const { data: { user } } = await supabase.auth.getUser(); if (user) { setUserEmail(user.email || ''); setUserId(user.id); const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single(); setUsername(profile?.username || user.email?.split('@')[0] || 'Viajante'); const { data: roster, error } = await supabase.from('user_roster').select(`id, current_level, acquired_at, challenge_completed, game_characters (*)`).eq('user_id', user.id).order('acquired_at', { ascending: false }); if (error) console.log("Erro roster:", error.message); else setPlayedCharacters(roster as any || []); } const { data: vict } = await supabase.from('victories').select('*'); setVictories(vict || []); await fetchCatalogs(); } catch (error: any) { console.log(error); } finally { setLoading(false); setRefreshing(false); } }, []);
  useEffect(() => { fetchData(); }, []);
  useEffect(() => { if (lobbyModalVisible) fetchCatalogs(); }, [lobbyModalVisible]);

  const fetchHistory = async () => { setLoading(true); const { data } = await supabase.from('match_history').select('*').order('played_at', { ascending: false }).limit(10); if (data) setMatchHistory(data); setLoading(false); setHistoryModalVisible(true); };
  
  const uploadToSupabase = async (uri: string): Promise<string | null> => { try { setUploadingImage(true); const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }); const arrayBuffer = decode(base64); const fileExt = uri.split('.').pop()?.toLowerCase() ?? 'jpg'; const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`; const filePath = `${fileName}`; const { error: uploadError } = await supabase.storage.from('rpg-images').upload(filePath, arrayBuffer, { contentType: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`, upsert: false }); if (uploadError) throw uploadError; const { data } = supabase.storage.from('rpg-images').getPublicUrl(filePath); return data.publicUrl; } catch (error: any) { Alert.alert("Erro no upload", error.message || "Erro desconhecido"); return null; } finally { setUploadingImage(false); } };
  const pickImage = async () => { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 }); if (!result.canceled) setPickedImageUri(result.assets[0].uri); };
  const pickBanner = async () => { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [16, 9], quality: 0.5 }); if (!result.canceled) setPickedBannerUri(result.assets[0].uri); };
  const pickEventImage = async () => { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [16, 9], quality: 0.5, }); if (!result.canceled) { setPickedEventImageUri(result.assets[0].uri); } };

  // ==================================================================================
  // 6. LÓGICA DE EVENTOS
  // ==================================================================================
  
  const openCreateEventModal = () => { 
      setEditingEventId(null); setNewEventTitle(''); setNewEventDesc(''); setNewEventImage(''); setPickedEventImageUri(''); 
      setEventCharacters([]); 
      setCreateEventModalVisible(true); 
  };
  
  const openEditEventModal = (ev: GameEvent) => { 
      setEditingEventId(ev.id); setNewEventTitle(ev.title); setNewEventDesc(ev.description); setNewEventImage(ev.image_url||''); setPickedEventImageUri(''); 
      setEventCharacters(ev.event_characters || []); 
      setCreateEventModalVisible(true); 
  }

  // --- SUB-MODAL: PERSONAGEM DO EVENTO ---
  const openAddEventChar = () => {
      setEvCharName(''); setEvCharHp('10'); setEvCharHasLife(true); setEvCharIsBoss(false); setEvCharSkills([]);
      setBossSkillName(''); setBossSkillDesc(''); setEditingBossSkillIndex(null);
      setEditingEventCharIndex(null); setEditingEvCharSkillIndex(null); 
      clearSkillForm();
      setCreateEventCharModalVisible(true);
  }

  const openEditEventChar = (index: number) => {
      const char = eventCharacters[index];
      setEvCharName(char.name); 
      setEvCharHp(String(char.base_hp)); 
      setEvCharHasLife(char.has_life); 
      setEvCharIsBoss(char.is_boss); 
      setEvCharSkills(char.skills || []);
      setEditingEventCharIndex(index); 
      setEditingEvCharSkillIndex(null); 
      clearSkillForm();
      setCreateEventCharModalVisible(true);
  }

  // --- SKILLS DO PERSONAGEM DO EVENTO ---
  const addEvCharSkill = () => {
      if(!skillName) return Alert.alert("Ops", "Nome da habilidade?");
      const newSkill: CharacterSkill = {
        id: (editingEvCharSkillIndex !== null) ? evCharSkills[editingEvCharSkillIndex].id : Math.random().toString(), 
        name: skillName, description: skillDesc, cost: skillCost, type: skillType,
        passive_type: skillType === 'passive' ? 'individual' : undefined, active_type: skillType === 'active' ? 'individual' : undefined,
        duration: parseInt(skillDuration) || 0, shield_value: skillGeneratesShield ? parseInt(skillShieldValue) || 0 : 0,
        unlock_level: 1, is_hit_based: false, hit_value: 0,
        combat_state: evCharIsBoss ? skillCombatState : 'normal' // Força normal se não for boss
      };
      if (editingEvCharSkillIndex !== null) {
          const updated = [...evCharSkills]; updated[editingEvCharSkillIndex] = newSkill; setEvCharSkills(updated);
      } else { setEvCharSkills([...evCharSkills, newSkill]); }
      setEditingEvCharSkillIndex(null); clearSkillForm();
  }

  const handleEditEvCharSkill = (index: number) => {
      const s = evCharSkills[index]; if(!s) return;
      setSkillName(s.name); setSkillDesc(s.description); setSkillCost(s.cost||''); setSkillDuration(String(s.duration||''));
      setSkillType(s.type); 
      if(s.shield_value) { setSkillGeneratesShield(true); setSkillShieldValue(String(s.shield_value)); } else { setSkillGeneratesShield(false); }
      setSkillCombatState(s.combat_state || 'normal');
      setEditingEvCharSkillIndex(index);
  }

  const removeEvCharSkill = (index: number) => {
      const updated = [...evCharSkills]; updated.splice(index, 1); setEvCharSkills(updated);
  }

  // --- BOSS SKILLS (PASSIVAS GLOBAIS) ---
  const addBossSkill = () => { 
      if (!bossSkillName || !bossSkillDesc) return Alert.alert("Erro", "Preencha Nome e Descrição."); 
      const newSkill: BossSkillLocal = { name: bossSkillName, description: bossSkillDesc, target: bossSkillTarget }; 
      if (editingBossSkillIndex !== null) {
          const updated = [...bossSkills]; updated[editingBossSkillIndex] = newSkill; setBossSkills(updated); setEditingBossSkillIndex(null);
      } else { setBossSkills([...bossSkills, newSkill]); }
      setBossSkillName(''); setBossSkillDesc(''); 
  };
  const handleEditBossSkill = (index: number) => {
      const skill = bossSkills[index]; setBossSkillName(skill.name); setBossSkillDesc(skill.description); setBossSkillTarget(skill.target); setEditingBossSkillIndex(index);
  }
  const removeBossSkill = (index: number) => { const updated = [...bossSkills]; updated.splice(index, 1); setBossSkills(updated); };

  const saveEventChar = () => {
      if(!evCharName) return Alert.alert("Ops", "Nome do personagem?");
      const finalHp = evCharHasLife ? (parseInt(evCharHp) || 0) : 0;
      
      const charData: EventCharacter = {
          name: evCharName, base_hp: finalHp, has_life: evCharHasLife, is_boss: evCharIsBoss, skills: evCharSkills
      };
      
      if (editingEventCharIndex !== null) {
          const updated = [...eventCharacters]; updated[editingEventCharIndex] = charData; setEventCharacters(updated);
      } else {
          setEventCharacters([...eventCharacters, charData]);
      }
      setCreateEventCharModalVisible(false);
  }

  const removeEventChar = (index: number) => {
      Alert.alert("Remover", "Remover este personagem do evento?", [{text:"Não"}, {text:"Sim", onPress:() => {
          const updated = [...eventCharacters]; updated.splice(index, 1); setEventCharacters(updated);
      }}]);
  }

  const handleSaveEvent = async () => { 
      if(!newEventTitle) return Alert.alert("Erro", "Título obrigatório"); 
      setSaving(true); 
      try { 
          let finalImageUrl = newEventImage; 
          if (pickedEventImageUri) { const uploadedUrl = await uploadToSupabase(pickedEventImageUri); if (uploadedUrl) finalImageUrl = uploadedUrl; }
          
          const p = {
              title: newEventTitle, description: newEventDesc, image_url: finalImageUrl||null, 
              event_characters: eventCharacters 
          }; 
          
          if(editingEventId) await supabase.from('game_events').update(p).eq('id',editingEventId); 
          else await supabase.from('game_events').insert(p); 
          
          setCreateEventModalVisible(false); fetchCatalogs(); 
      } catch (e: any) { Alert.alert("Erro", e.message); } finally { setSaving(false); }
  };
  const deleteEvent = async(id:string) => { Alert.alert("Apagar Evento", "Confirmar?", [{text:"Cancelar"}, {text:"Apagar", onPress:async()=>{await supabase.from('game_events').delete().eq('id',id); fetchCatalogs();}}]); }

  // -------------------------------------------------------------------------
  // RESTANTE DAS FUNÇÕES (PARCEIROS, CHARS, ETC)
  // -------------------------------------------------------------------------
  const openCreateCharModal = () => { setEditingCharId(null); setNewName(''); setNewOrigin(''); setNewClass(''); setNewImage(''); setHpInput1('10'); setNewCategory('individual'); setTeamMembers([]); setMemberName(''); setMemberHp(''); setHasShield(false); setShieldInput('0'); setPickedImageUri(''); setTempSkills([]); clearSkillForm(); setNewBanner(''); setPickedBannerUri(''); setHasLevelSystem(false); setMaxLevelsInput(''); setHasPartners(false); setPartners([]); setCreateCharModalVisible(true); };
  const openEditCharModal = async (char: GameCharacterWithCreator) => { setEditingCharId(char.id); setNewName(char.name); setNewOrigin(char.anime_origin); setNewClass(char.base_class); setNewImage(char.image_url || ''); setPickedImageUri(''); setNewCategory(char.category || 'individual'); if (char.category === 'equipe') { setTeamMembers(char.team_members || []); setHpInput1('0'); setHasPartners(false); setPartners([]); } else { setHpInput1(String(char.base_hp)); if (char.team_members && char.team_members.length > 0) { setHasPartners(true); setPartners(char.team_members as PartnerMember[]); } else { setHasPartners(false); setPartners([]); } } setHasShield((char.base_shield || 0) > 0); setShieldInput(String(char.base_shield || 0)); setNewBanner(char.challenge_banner_url || ''); setPickedBannerUri(''); setHasLevelSystem(char.has_level_system || false); setMaxLevelsInput(char.max_levels ? String(char.max_levels) : ''); const { data: skills } = await supabase.from('character_skills').select('*').eq('character_id', char.id); if(skills) { setTempSkills(skills.map(s => ({ id: s.id, name: s.name, description: s.description, type: s.type as any, passive_type: s.passive_type, active_type: s.active_type, cost: s.cost || '', duration: s.duration || 0, shield_value: s.shield_value || 0, unlock_level: s.unlock_level || 1, is_hit_based: s.is_hit_based || false, hit_value: s.hit_value || 0 }))); } else { setTempSkills([]); } clearSkillForm(); setCreateCharModalVisible(true); };
  const openAddPartner = () => { setPartnerName(''); setPartnerHasLife(true); setPartnerLifeType('numeric'); setPartnerHpInput('10'); setPartnerSkills([]); setPartnerHasLevelSystem(false); setPartnerMaxLevelsInput(''); setEditingPartnerIndex(null); setEditingPartnerSkillIndex(null); clearSkillForm(); setPartnerModalVisible(true); };
  const openEditPartner = (index: number) => { const p = partners[index]; setPartnerName(p.name); setPartnerHasLife(p.has_life); setPartnerLifeType(p.life_type); setPartnerHpInput(p.base_hp.toString()); setPartnerSkills(p.skills || []); setPartnerHasLevelSystem(p.has_level_system || false); setPartnerMaxLevelsInput(p.max_levels ? String(p.max_levels) : ''); setEditingPartnerIndex(index); setEditingPartnerSkillIndex(null); clearSkillForm(); setPartnerModalVisible(true); };
  const addPartnerSkill = () => { if(!skillName) return Alert.alert("Ops", "Nome obrigatório"); const unlockLvl = partnerHasLevelSystem ? parseInt(skillUnlockLevel) : 1; const newSkill: CharacterSkill = { id: (editingPartnerSkillIndex !== null) ? partnerSkills[editingPartnerSkillIndex].id : Math.random().toString(), name: skillName, description: skillDesc, cost: skillCost, type: skillType, passive_type: skillType === 'passive' ? 'individual' : undefined, active_type: skillType === 'active' ? 'individual' : undefined, duration: parseInt(skillDuration) || 0, shield_value: skillGeneratesShield ? parseInt(skillShieldValue) || 0 : 0, unlock_level: isNaN(unlockLvl) ? 1 : unlockLvl, is_hit_based: skillType === 'transformation' ? skillIsHitBased : false, hit_value: (skillType === 'transformation' && skillIsHitBased) ? (parseInt(skillHitValueInput) || 0) : 0 }; if (editingPartnerSkillIndex !== null) { const updatedSkills = [...partnerSkills]; updatedSkills[editingPartnerSkillIndex] = newSkill; setPartnerSkills(updatedSkills); Alert.alert("Sucesso", "Habilidade do parceiro atualizada!"); } else { setPartnerSkills([...partnerSkills, newSkill]); } setEditingPartnerSkillIndex(null); clearSkillForm(); };
  const handleEditPartnerSkill = (index: number) => { const skill = partnerSkills[index]; if (!skill) return; setSkillName(skill.name); setSkillDesc(skill.description); setSkillCost(skill.cost || ''); setSkillDuration((skill.duration && skill.duration > 0) ? String(skill.duration) : ''); setSkillType(skill.type as any); setSkillUnlockLevel(skill.unlock_level ? String(skill.unlock_level) : '1'); setSkillIsHitBased(skill.is_hit_based || false); setSkillHitValueInput(skill.hit_value ? String(skill.hit_value) : ''); if (skill.shield_value && skill.shield_value > 0) { setSkillGeneratesShield(true); setSkillShieldValue(String(skill.shield_value)); } else { setSkillGeneratesShield(false); setSkillShieldValue(''); } setEditingPartnerSkillIndex(index); };
  const removePartnerSkill = (index: number) => { Alert.alert("Excluir Skill", "Apagar habilidade do parceiro?", [ { text: "Cancelar", style: "cancel" }, { text: "Apagar", style: "destructive", onPress: () => { const updated = [...partnerSkills]; updated.splice(index, 1); setPartnerSkills(updated); }}]); };
  const savePartner = () => { if(!partnerName) return Alert.alert("Ops", "Nome do parceiro?"); const finalHp = partnerHasLife ? (parseInt(partnerHpInput) || 1) : 0; const partnerData: PartnerMember = { name: partnerName, base_hp: finalHp, has_life: partnerHasLife, life_type: partnerLifeType, skills: partnerSkills, has_level_system: partnerHasLevelSystem, max_levels: partnerHasLevelSystem ? (parseInt(partnerMaxLevelsInput) || 0) : 0 }; if (editingPartnerIndex !== null) { const updatedPartners = [...partners]; updatedPartners[editingPartnerIndex] = partnerData; setPartners(updatedPartners); Alert.alert("Sucesso", "Parceiro atualizado!"); } else { setPartners([...partners, partnerData]); } setPartnerModalVisible(false); };
  const removePartner = (index: number) => { Alert.alert("Remover", "Deseja remover este parceiro?", [ {text:"Cancelar", style: "cancel"}, {text:"Sim, Remover", style: "destructive", onPress:()=>{ const p = [...partners]; p.splice(index, 1); setPartners(p); }}]); };
  const handleSaveChar = async () => { if(!newName || !newOrigin || !newClass) return Alert.alert("Erro", "Preencha os dados básicos"); setSaving(true); try { let finalImageUrl = newImage; if (pickedImageUri) { const uploadedUrl = await uploadToSupabase(pickedImageUri); if (uploadedUrl) finalImageUrl = uploadedUrl; else throw new Error("Falha no upload da imagem"); } let finalBannerUrl = newBanner; if (pickedBannerUri) { const uploadedBannerUrl = await uploadToSupabase(pickedBannerUri); if (uploadedBannerUrl) finalBannerUrl = uploadedBannerUrl; else throw new Error("Falha no upload do banner"); } let finalHp = 10; let finalUnitCount = 1; let finalTeamData: any = null; if (newCategory === 'equipe') { finalHp = 0; finalUnitCount = teamMembers.length; if (teamMembers.length === 0) return Alert.alert("Erro", "Adicione membros."); finalTeamData = teamMembers; } else { if (newCategory === 'hit') finalHp = parseInt(hpInput1) || 1; else finalHp = parseInt(hpInput1) || 10; if (hasPartners && partners.length > 0) { finalTeamData = partners; finalUnitCount = 1 + partners.length; } } const charPayload = { name: newName, anime_origin: newOrigin, base_class: newClass, image_url: finalImageUrl || null, challenge_banner_url: finalBannerUrl || null, base_hp: finalHp, category: newCategory, unit_count: finalUnitCount, team_members: finalTeamData, base_shield: hasShield ? (parseInt(shieldInput) || 0) : 0, has_level_system: hasLevelSystem, max_levels: hasLevelSystem ? (parseInt(maxLevelsInput) || 0) : 0 }; let charId = editingCharId; if(editingCharId) { await supabase.from('game_characters').update(charPayload).eq('id', editingCharId); await supabase.from('character_skills').delete().eq('character_id', editingCharId); } else { const { data, error } = await supabase.from('game_characters').insert(charPayload).select().single(); if (error) throw error; charId = data.id; } if (charId && newCategory !== 'equipe' && tempSkills.length > 0) { const skillsToInsert = tempSkills.map(s => ({ character_id: charId, name: s.name, description: s.description, type: s.type, passive_type: s.passive_type, active_type: s.active_type, cost: s.cost, duration: s.duration, shield_value: s.shield_value, unlock_level: s.unlock_level || 1, is_hit_based: s.is_hit_based, hit_value: s.hit_value })); const { error: skillError } = await supabase.from('character_skills').insert(skillsToInsert); if (skillError) throw skillError; } Alert.alert("Sucesso", "Personagem salvo!"); setCreateCharModalVisible(false); fetchCatalogs(); if(currentRoom) setLobbyModalVisible(true); } catch (e: any) { Alert.alert("Erro ao salvar", e.message); } finally { setSaving(false); setUploadingImage(false); } };
  const handleDeleteChar = async (id: string) => { Alert.alert("Excluir", "Tem certeza?", [ { text: "Cancelar" }, { text: "Excluir", onPress: async () => { await supabase.from('game_characters').delete().eq('id', id); fetchCatalogs(); }}]); };
  const handleEditSkill = (index: number) => { const skill = tempSkills[index]; if (!skill) return; setSkillName(skill.name || ''); setSkillDesc(skill.description || ''); setSkillCost(skill.cost || ''); setSkillDuration((skill.duration !== undefined && skill.duration !== -1) ? String(skill.duration) : ''); setSkillType(skill.type || 'active'); setSkillUnlockLevel(skill.unlock_level ? String(skill.unlock_level) : '1'); setSkillIsHitBased(skill.is_hit_based || false); setSkillHitValueInput(skill.hit_value ? String(skill.hit_value) : ''); const pType = skill.passive_type; const aType = skill.active_type; if (skill.type === 'passive') { if (pType === 'general') { setPassiveCondition('normal'); setIsSkillGeneral(true); } else if (pType === 'general_transformed') { setPassiveCondition('transformed'); setIsSkillGeneral(true); } else if (pType === 'transformed') { setPassiveCondition('transformed'); setIsSkillGeneral(false); } else { setPassiveCondition('normal'); setIsSkillGeneral(false); } } else if (skill.type === 'active') { if (aType === 'general') { setActiveCondition('normal'); setIsSkillGeneral(true); } else if (aType === 'transformed') { setActiveCondition('transformed'); setIsSkillGeneral(false); } else { setActiveCondition('normal'); setIsSkillGeneral(false); } } if (skill.shield_value && skill.shield_value > 0) { setSkillGeneratesShield(true); setSkillShieldValue(String(skill.shield_value)); } else { setSkillGeneratesShield(false); setSkillShieldValue(''); } setEditingSkillIndex(index); };
  const addMemberToTeam = () => { const hp = parseInt(memberHp); if (!memberName || isNaN(hp)) { Alert.alert("Ops", "Preencha nome e vida válida."); return; } const generalSkills = tempSkills.filter(s => (s.type === 'passive' && (s.passive_type === 'general' || s.passive_type === 'general_transformed')) || (s.type === 'active' && s.active_type === 'general')); setTeamMembers([...teamMembers, { name: memberName, base_hp: hp, skills: generalSkills as CharacterSkill[] }]); setMemberName(''); setMemberHp(''); };
  const removeMemberFromTeam = (index: number) => { Alert.alert("Remover Membro", "Tem certeza?", [ { text: "Cancelar", style: "cancel" }, { text: "Remover", style: "destructive", onPress: () => { const updated = [...teamMembers]; updated.splice(index, 1); setTeamMembers(updated); }}]); };
  const openMemberSkills = (index: number) => { setCurrentMemberIndex(index); const member = teamMembers[index]; setTempSkills(member.skills || []); clearSkillForm(); setMemberSkillsModalVisible(true); };
  const closeMemberSkills = () => { if (currentMemberIndex !== null) { const updatedMembers = [...teamMembers]; updatedMembers[currentMemberIndex].skills = tempSkills as CharacterSkill[]; setTeamMembers(updatedMembers); } setTempSkills([]); setCurrentMemberIndex(null); clearSkillForm(); setMemberSkillsModalVisible(false); };
  const addSkillToTempList = () => { if (!skillName) return Alert.alert("Ops", "Dê um nome para a habilidade"); let finalPassiveType = undefined; let finalActiveType = undefined; if (skillType === 'passive') { if (passiveCondition === 'normal') finalPassiveType = isSkillGeneral ? 'general' : 'individual'; else finalPassiveType = isSkillGeneral ? 'general_transformed' : 'transformed'; } else if (skillType === 'active') { if (activeCondition === 'normal') finalActiveType = isSkillGeneral ? 'general' : 'individual'; else finalActiveType = 'transformed'; } const parsedDuration = parseInt(skillDuration); const finalDuration = (!skillDuration || isNaN(parsedDuration)) ? -1 : parsedDuration; const level = parseInt(skillUnlockLevel); const finalLevel = (isNaN(level) || level < 1) ? 1 : level; const newSkillData: Partial<CharacterSkill> = { id: editingSkillIndex !== null ? tempSkills[editingSkillIndex].id : Math.random().toString(), name: skillName, description: skillDesc, cost: skillCost, type: skillType, passive_type: finalPassiveType as any, active_type: finalActiveType as any, duration: finalDuration, shield_value: skillGeneratesShield ? (parseInt(skillShieldValue) || 0) : 0, unlock_level: finalLevel, is_hit_based: skillType === 'transformation' ? skillIsHitBased : false, hit_value: (skillType === 'transformation' && skillIsHitBased) ? (parseInt(skillHitValueInput) || 0) : 0 }; const isGeneral = (newCategory === 'equipe') && (finalPassiveType?.includes('general') || finalActiveType === 'general'); if (isGeneral && teamMembers.length > 0) { const updatedMembers = teamMembers.map(m => { const currentSkills = m.skills || []; if (editingSkillIndex !== null && tempSkills[editingSkillIndex]) { const skillToReplaceId = tempSkills[editingSkillIndex].id; const hasSkill = currentSkills.some(s => s.id === skillToReplaceId); if (hasSkill) { const newSkills = currentSkills.map(s => s.id === skillToReplaceId ? {...s, ...newSkillData} : s); return { ...m, skills: newSkills as CharacterSkill[] }; } else { return { ...m, skills: [...currentSkills, newSkillData] as CharacterSkill[] }; } } else { return { ...m, skills: [...currentSkills, newSkillData] as CharacterSkill[] }; } }); setTeamMembers(updatedMembers); Alert.alert("Aplicado", "Habilidade Geral propagada para todos os membros!"); } if (editingSkillIndex !== null) { const updatedSkills = [...tempSkills]; updatedSkills[editingSkillIndex] = newSkillData; setTempSkills(updatedSkills); Alert.alert("Sucesso", "Habilidade atualizada!"); } else { setTempSkills([...tempSkills, newSkillData]); } clearSkillForm(); };
  const removeSkillFromTemp = (index: number) => { Alert.alert("Apagar Habilidade", "Tem certeza?", [ { text: "Cancelar", style: "cancel" }, { text: "Apagar", style: "destructive", onPress: () => { const skillToRemove = tempSkills[index]; if (newCategory === 'equipe' && skillToRemove) { const isGeneral = (skillToRemove.type === 'passive' && (skillToRemove.passive_type === 'general' || skillToRemove.passive_type === 'general_transformed')) || (skillToRemove.type === 'active' && skillToRemove.active_type === 'general'); if (isGeneral) { const updatedMembers = teamMembers.map(m => ({ ...m, skills: (m.skills || []).filter(s => s.id !== skillToRemove.id) })); setTeamMembers(updatedMembers); Alert.alert("Removido", "Habilidade Geral removida de todos os membros."); } } const updated = [...tempSkills]; updated.splice(index, 1); setTempSkills(updated); }}]); };
  const handleCreateRoom = async () => { let currentUserId = userId; let currentUserEmail = userEmail; if (!currentUserId) { const { data: { user } } = await supabase.auth.getUser(); if (!user) return Alert.alert("Erro", "Você precisa estar logado."); currentUserId = user.id; currentUserEmail = user.email || ''; setUserId(currentUserId); setUserEmail(currentUserEmail); } const code = generateRoomCode(); const { data, error } = await supabase.from('rooms').insert({ code, host_id: currentUserId, status: 'waiting' }).select().single(); if (error) return Alert.alert('Erro ao criar sala', error.message); if (!data) return Alert.alert('Erro', 'Falha ao criar sala.'); const { error: partError } = await supabase.from('room_participants').insert({ room_code: code, user_id: currentUserId, user_email: currentUserEmail, username }); if (partError) return Alert.alert('Erro ao entrar', partError.message); setCurrentRoom(data); setParticipants([{ id: 'local', room_code: code, user_id: currentUserId, user_email: currentUserEmail, username, is_ready: false, current_hp: 10, max_hp: 10 }]); subscribeToRoom(code); setLobbyModalVisible(true); };
  const handleJoinRoom = async () => { const code = joinCode.toUpperCase(); if (code.length !== 4) return Alert.alert('Erro', 'Código inválido'); const { data: room, error } = await supabase.from('rooms').select('*').eq('code', code).single(); if (error || !room) return Alert.alert('Erro', 'Sala não encontrada'); const { error: joinError } = await supabase.from('room_participants').insert({ room_code: code, user_id: userId, user_email: userEmail, username }); if (joinError && joinError.code !== '23505') return Alert.alert('Erro ao entrar', joinError.message); setCurrentRoom(room); fetchParticipants(code); subscribeToRoom(code); setLobbyModalVisible(true); };
  const handleStartSelection = async () => { if (!currentRoom) return; await supabase.from('rooms').update({ status: 'selecting' }).eq('code', currentRoom.code); };
  const handleSelectCharacter = async (charId: string) => { if (!currentRoom) return; await supabase.from('room_participants').update({ selected_character_id: charId, is_ready: true }).eq('room_code', currentRoom.code).eq('user_id', userId); const existing = playedCharacters.find(p => p.game_characters && p.game_characters.id === charId); if (!existing) { await supabase.from('user_roster').insert({ user_id: userId, character_id: charId, current_level: 1 }); fetchData(); } };
  const handleStartGame = async () => { if (!currentRoom) return; 
    let finalEventId = '';
    // LÓGICA DE SELEÇÃO DE EVENTO (ALEATÓRIO OU MANUAL)
    if (eventSelectionMode === 'random') {
       let availableEvents = catalogEvents; 
       if (availableEvents.length === 0) { const { data } = await supabase.from('game_events').select('*'); if (data && data.length > 0) availableEvents = data; else return Alert.alert('Erro', 'Nenhum evento disponível.'); } 
       const randomEvent = availableEvents[Math.floor(Math.random() * availableEvents.length)];
       finalEventId = randomEvent.id;
    } else {
       if (!lobbySelectedEventId) return Alert.alert("Atenção", "Selecione um evento da lista!");
       finalEventId = lobbySelectedEventId;
    }

    const everyoneReady = participants.every(p => p.is_ready); 
    if (!everyoneReady) return Alert.alert('Aguarde', 'Jogadores escolhendo...'); 
    setSaving(true); 
    try { 
        const shuffled = [...participants].sort(() => Math.random() - 0.5); 
        for (let i = 0; i < shuffled.length; i++) { 
            const selectedCharId = shuffled[i].selected_character_id; 
            const charData = catalogChars.find(c => c.id === selectedCharId); 
            let initialHp = 10; let initialShield = charData?.base_shield || 0; let initialTeamState: any[] = []; 
            if (charData?.category === 'equipe') { initialHp = 0; initialTeamState = []; } else { initialHp = charData?.base_hp || 10; } 
            await supabase.from('room_participants').update({ turn_order: i + 1, current_hp: initialHp, max_hp: initialHp, current_shield: initialShield, buffs: '', debuffs: '', active_transformations: [], team_state: initialTeamState, active_member_name: null }).eq('id', shuffled[i].id); 
        } 
        await supabase.from('rooms').update({ status: 'playing', selected_event_id: finalEventId, current_turn_participant_id: shuffled[0].id }).eq('code', currentRoom.code); 
    } catch (error: any) { Alert.alert('Erro', error.message); } finally { setSaving(false); } 
  };
  const handleLeaveRoom = async () => { if (currentRoom) { if (roomChannelRef.current) supabase.removeChannel(roomChannelRef.current); await supabase.from('room_participants').delete().eq('room_code', currentRoom.code).eq('user_id', userId); } setLobbyModalVisible(false); setCurrentRoom(null); setParticipants([]); };
  const handleToggleChallenge = async (item: UserRosterItem) => { const newValue = !item.challenge_completed; setPlayedCharacters(prev => prev.map(p => p.id === item.id ? { ...p, challenge_completed: newValue } : p)); if (selectedCharacter && selectedCharacter.id === item.id) { setSelectedCharacter({ ...selectedCharacter, challenge_completed: newValue }); } await supabase.from('user_roster').update({ challenge_completed: newValue }).eq('id', item.id); };
  const handleOpenDetails = async (item: UserRosterItem) => { if (!item.game_characters) return; setSelectedCharacter(item); setLoadingStats(true); setDetailsModalVisible(true); const { count: winsCount } = await supabase.from('victories').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('character_name', item.game_characters.name); const charWins = winsCount || 0; const { data: allHistory } = await supabase.from('match_history').select('participants_snapshot'); let charMatches = 0; if (allHistory) { allHistory.forEach(match => { const played = match.participants_snapshot.some((p: any) => p.user_id === userId && p.selected_character_id === item.game_characters?.id); if (played) charMatches++; }); } if (charMatches < charWins) charMatches = charWins; const rate = charMatches > 0 ? Math.round((charWins / charMatches) * 100) : 0; setSelectedCharStats({ wins: charWins, matches: charMatches, winRate: rate, missions: 0 }); setLoadingStats(false); };
  const openCreateEffectModal = () => { setEditingEffectId(null); setEffectTitle(''); setEffectDesc(''); setEffectDamage(''); setEffectDuration(''); setEffectType('buff'); setCreateEffectModalVisible(true); };
  const openEditEffectModal = (eff: StatusEffect) => { setEditingEffectId(eff.id); setEffectTitle(eff.title); setEffectDesc(eff.description); setEffectType(eff.type); setEffectDamage(eff.damage || ''); setEffectDuration(String(eff.duration || '')); setCreateEffectModalVisible(true); };
  const handleSaveEffect = async () => { if(!effectTitle) return Alert.alert("Erro", "Título é obrigatório"); const p = { title: effectTitle, description: effectDesc, type: effectType, damage: effectType === 'debuff' ? effectDamage : null, duration: parseInt(effectDuration) || 0 }; if(editingEffectId) await supabase.from('game_status_effects').update(p).eq('id', editingEffectId); else await supabase.from('game_status_effects').insert(p); setCreateEffectModalVisible(false); fetchCatalogs(); };
  const deleteEffect = async(id:string) => { Alert.alert("Apagar Efeito", "Confirmar?", [{text:"Cancelar"}, {text:"Apagar", onPress:async()=>{await supabase.from('game_status_effects').delete().eq('id',id); fetchCatalogs();}}]); };

  const renderPlayedChar = (item: UserRosterItem) => { 
    if (!item.game_characters) return null; 
    return ( 
      <TouchableOpacity key={item.id} style={styles.card} onPress={() => handleOpenDetails(item)}> 
        {item.game_characters?.image_url ? 
          <Image source={{ uri: item.game_characters.image_url }} style={styles.charImage} /> : 
          <View style={[styles.charIcon, { backgroundColor: '#3e2e6b' }]}><Text style={{fontSize: 20}}>⚔️</Text></View> 
        } 
        <View style={{flex: 1}}> 
          <Text style={styles.cardTitle}>{item.game_characters?.name || 'Unknown'}</Text> 
          <View style={{flexDirection:'row', alignItems:'center'}}> 
            <Text style={styles.cardSubtitle}>Nível {item.current_level} • {item.game_characters?.base_class}</Text> 
            <View style={{marginLeft: 8, paddingHorizontal:6, paddingVertical:2, borderRadius:4, backgroundColor: getCategoryColor(item.game_characters?.category), opacity: 0.8}}> 
              <Text style={{fontSize:8, fontWeight:'bold', color:'#000'}}>{item.game_characters?.category?.toUpperCase() || 'IND.'}</Text> 
            </View> 
          </View> 
        </View> 
      </TouchableOpacity> 
    ); 
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}><View><Text style={styles.greeting}>Olá, {username}</Text><Text style={styles.userEmail}>{userEmail}</Text></View><View style={{flexDirection:'row'}}><TouchableOpacity onPress={fetchHistory} style={[styles.logoutButton, {marginRight:10, backgroundColor:'#8257e5'}]}><Ionicons name="time" size={24} color="#fff" /></TouchableOpacity><TouchableOpacity onPress={async () => await supabase.auth.signOut()} style={styles.logoutButton}><Ionicons name="log-out-outline" size={24} color="#ff4444" /></TouchableOpacity></View></View>
      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor="#8257e5"/>}>
        <View style={styles.matchmakingContainer}><Text style={styles.sectionTitle}>Multiplayer</Text><TouchableOpacity style={styles.newGameButton} onPress={() => { handleCreateRoom(); fetchCatalogs(); }}><View style={styles.newGameIcon}><Ionicons name="add" size={32} color="#fff" /></View><View><Text style={styles.newGameTitle}>CRIAR SALA</Text><Text style={styles.newGameSubtitle}>Seja o Host da partida</Text></View></TouchableOpacity><View style={styles.joinContainer}><TextInput style={styles.joinInput} placeholder="CÓDIGO" placeholderTextColor="#555" maxLength={4} autoCapitalize="characters" value={joinCode} onChangeText={setJoinCode}/><TouchableOpacity style={styles.joinButton} onPress={() => { handleJoinRoom(); fetchCatalogs(); }}><Text style={styles.joinButtonText}>ENTRAR</Text></TouchableOpacity></View></View>
        
        {/* BOTÕES DE AÇÃO DESTACADOS */}
        <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.createButton, {backgroundColor: '#202024', borderWidth: 1, borderColor: '#8257e5', flex: 1, marginRight: 5}]} onPress={openCreateCharModal}>
                <Ionicons name="person-add" size={18} color="#8257e5" style={{marginRight: 5}}/>
                <Text style={styles.createButtonText}>Add Char</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.createButton, {backgroundColor: '#202024', borderWidth: 1, borderColor: '#00B37E', flex: 1, marginHorizontal: 5}]} onPress={() => { setManageEventsModalVisible(true); fetchCatalogs(); }}>
                <Ionicons name="library" size={18} color="#00B37E" style={{marginRight: 5}}/>
                <Text style={[styles.createButtonText, {color: '#00B37E'}]}>Eventos</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.createButton, {backgroundColor: '#202024', borderWidth: 1, borderColor: '#FFD700', flex: 1, marginLeft: 5}]} onPress={() => { setManageEffectsModalVisible(true); fetchCatalogs(); }}>
                <Ionicons name="flask" size={18} color="#FFD700" style={{marginRight: 5}}/>
                <Text style={[styles.createButtonText, {color: '#FFD700'}]}>Efeitos</Text>
            </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Seu Histórico</Text>
        {playedCharacters.length === 0 ? <Text style={styles.emptyText}>Sem histórico.</Text> : playedCharacters.map(item => renderPlayedChar(item))}
      </ScrollView>

      {/* LOBBY */}
      <Modal animationType="slide" transparent={false} visible={lobbyModalVisible} onRequestClose={()=>{}}><View style={styles.lobbyContainer}><View style={styles.lobbyHeader}><Text style={styles.lobbyTitle}>Sala: {currentRoom?.code}</Text><TouchableOpacity onPress={handleLeaveRoom}><Ionicons name="close-circle" size={32} color="#ff4444" /></TouchableOpacity></View>{currentRoom?.status === 'waiting' && (<View style={{flex: 1, justifyContent:'center', alignItems:'center'}}><Text style={styles.phaseTitle}>Aguardando...</Text><View style={styles.participantsList}>{participants.map(p => (<View key={p.id} style={styles.participantRow}><Ionicons name="person" size={20} color="#fff" /><Text style={styles.participantName}>{p.username}</Text>{!!(p.user_id === currentRoom.host_id) && <Text style={{color:'#FFD700', marginLeft:5}}>👑</Text>}</View>))}</View>
      
      {/* SELEÇÃO DE MODO DE EVENTO (SÓ PARA O HOST) */}
      {userId === currentRoom.host_id ? (
          <View style={{width: '100%', paddingHorizontal: 10}}>
              <Text style={{color:'#aaa', marginBottom:10, textAlign:'center'}}>Selecione o Modo de Evento:</Text>
              <View style={{flexDirection:'row', justifyContent:'center', marginBottom:20}}>
                  <TouchableOpacity onPress={() => setEventSelectionMode('random')} style={[styles.typeBadge, eventSelectionMode === 'random' && {backgroundColor:'#8257e5', borderColor:'#8257e5'}]}>
                      <Text style={styles.typeText}>ALEATÓRIO</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setEventSelectionMode('manual')} style={[styles.typeBadge, eventSelectionMode === 'manual' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}>
                      <Text style={styles.typeText}>MANUAL</Text>
                  </TouchableOpacity>
              </View>

              {eventSelectionMode === 'manual' && (
                  <View style={{height: 150, backgroundColor:'#222', borderRadius:8, padding:5, marginBottom:20}}>
                      <FlatList 
                          data={catalogEvents}
                          keyExtractor={item => item.id}
                          renderItem={({item}) => (
                              <TouchableOpacity 
                                  style={{padding:10, borderBottomWidth:1, borderBottomColor:'#333', backgroundColor: lobbySelectedEventId === item.id ? '#333' : 'transparent'}}
                                  onPress={() => setLobbySelectedEventId(item.id)}
                              >
                                  <Text style={{color: lobbySelectedEventId === item.id ? '#00B37E' : '#fff', fontWeight: lobbySelectedEventId === item.id ? 'bold' : 'normal'}}>
                                      {item.title}
                                  </Text>
                              </TouchableOpacity>
                          )}
                      />
                  </View>
              )}

              <TouchableOpacity style={styles.actionButton} onPress={handleStartSelection}><Text style={styles.actionButtonText}>INICIAR SELEÇÃO</Text></TouchableOpacity>
          </View>
      ) : (<Text style={{color:'#777'}}>Aguardando Host...</Text>)}
      
      </View>)}{currentRoom?.status === 'selecting' && (<View style={{flex: 1}}><Text style={styles.phaseTitle}>Escolha seu Herói</Text><Text style={{color:'#ccc', textAlign:'center', marginBottom:10}}>{participants.filter(p => p.is_ready).length} / {participants.length} prontos</Text>{participants.find(p => p.user_id === userId)?.is_ready ? (<View style={{flex:1, justifyContent:'center', alignItems:'center'}}><Ionicons name="checkmark-circle" size={64} color="#00B37E" /><Text style={{color:'#fff', marginTop:10}}>Selecionado!</Text>{userId === currentRoom.host_id && participants.every(p => p.is_ready) && (<TouchableOpacity style={[styles.actionButton, {marginTop:30, backgroundColor:'#FFD700'}]} onPress={handleStartGame} disabled={saving}><Text style={[styles.actionButtonText, {color:'#000'}]}>INICIAR PARTIDA</Text></TouchableOpacity>)}</View>) : (<FlatList data={catalogChars} keyExtractor={item => item.id} renderItem={({item}) => (<View style={styles.catalogItem}><TouchableOpacity style={{flex: 1, flexDirection:'row', alignItems:'center'}} onPress={() => handleSelectCharacter(item.id)}>{item.image_url ? <Image source={{uri: item.image_url}} style={styles.catalogImage} /> : <View style={styles.catalogImage} /> }<View style={styles.catalogInfo}><Text style={styles.catalogName}>{item.name} (HP: {item.base_hp})</Text><View style={{flexDirection:'row'}}><Text style={styles.catalogOrigin}>{item.base_class}</Text><Text style={[styles.catalogOrigin, {marginLeft: 10, color: getCategoryColor(item.category), fontWeight:'bold'}]}>• {item.category?.toUpperCase() || 'INDIVIDUAL'}</Text></View></View><Ionicons name="arrow-forward-circle" size={32} color="#8257e5" /></TouchableOpacity><View style={{flexDirection:'row', marginLeft: 10}}><TouchableOpacity onPress={() => openEditCharModal(item)} style={{padding:5}}><Ionicons name="pencil" size={20} color="#8257e5" /></TouchableOpacity><TouchableOpacity onPress={() => handleDeleteChar(item.id)} style={{padding:5}}><Ionicons name="trash" size={20} color="#ff4444" /></TouchableOpacity></View></View>)}/>)}</View>)}</View></Modal>
      
      {/* CREATE CHAR MODAL */}
      <Modal transparent visible={createCharModalVisible} animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, {maxHeight: '90%'}]}>
            <ScrollView contentContainerStyle={{paddingBottom: 50}}>
                <Text style={styles.modalTitle}>{editingCharId ? "Editar Personagem" : "Novo Personagem"}</Text>
                
                <Text style={styles.sectionHeader}>DADOS BÁSICOS</Text>
                <TextInput style={styles.input} placeholder="Nome" placeholderTextColor="#555" value={newName} onChangeText={setNewName}/>
                <TextInput style={styles.input} placeholder="Origem" placeholderTextColor="#555" value={newOrigin} onChangeText={setNewOrigin}/>
                <TextInput style={styles.input} placeholder="Classe" placeholderTextColor="#555" value={newClass} onChangeText={setNewClass}/>
                
                <Text style={styles.sectionHeader}>TIPO DE VIDA / ESTRUTURA</Text>
                <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:15}}>
                    <TouchableOpacity onPress={()=>setNewCategory('individual')} style={[styles.typeBadge, newCategory==='individual' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={[styles.typeText, newCategory!=='individual' && {color:'#777'}]}>INDIVIDUAL</Text></TouchableOpacity>
                    <TouchableOpacity onPress={()=>setNewCategory('equipe')} style={[styles.typeBadge, newCategory==='equipe' && {backgroundColor:'#FFD700', borderColor:'#FFD700'}]}><Text style={[styles.typeText, newCategory==='equipe' ? {color:'#000'} : {color:'#777'}]}>EQUIPE</Text></TouchableOpacity>
                    <TouchableOpacity onPress={()=>setNewCategory('hit')} style={[styles.typeBadge, newCategory==='hit' && {backgroundColor:'#ff4444', borderColor:'#ff4444'}]}><Text style={[styles.typeText, newCategory!=='hit' && {color:'#777'}]}>HIT</Text></TouchableOpacity>
                </View>

                {newCategory !== 'equipe' && (<TextInput style={styles.input} placeholder={newCategory === 'hit' ? "Quantidade de Hits (Ex: 5)" : "Vida Máxima (Ex: 60)"} placeholderTextColor="#555" value={hpInput1} onChangeText={setHpInput1} keyboardType="numeric"/>)}
                
                {/* SEÇÃO EQUIPE (Mantida para personagens tipo "Equipe") */}
                {newCategory === 'equipe' && (
                    <View style={{backgroundColor:'#222', padding:10, borderRadius:8, marginBottom:10}}>
                        <Text style={{color:'#aaa', marginBottom:10}}>Membros da Equipe (Adicione um a um):</Text>
                        {teamMembers.map((m, idx) => (
                            <View key={idx} style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5, borderBottomWidth:1, borderBottomColor:'#333', paddingBottom:5}}>
                                <View style={{flex:1}}>
                                    <Text style={{color:'#fff'}}>{m.name} ({m.base_hp} HP)</Text>
                                    <Text style={{color:'#777', fontSize:10}}>{(m.skills?.length || 0)} Habilidades</Text>
                                </View>
                                <View style={{flexDirection:'row'}}>
                                    <TouchableOpacity onPress={()=>openMemberSkills(idx)} style={{marginRight:15}}><Ionicons name="flash" size={16} color="#FFD700"/></TouchableOpacity>
                                    <TouchableOpacity onPress={()=>removeMemberFromTeam(idx)}><Ionicons name="trash" size={16} color="#ff4444"/></TouchableOpacity>
                                </View>
                            </View>
                        ))}
                        <View style={{flexDirection:'row', marginTop:10}}>
                            <TextInput style={[styles.input, {flex:2, marginBottom:0, marginRight:5}]} placeholder="Nome" placeholderTextColor="#555" value={memberName} onChangeText={setMemberName}/>
                            <TextInput style={[styles.input, {flex:1, marginBottom:0, marginRight:5}]} placeholder="HP" placeholderTextColor="#555" value={memberHp} onChangeText={setMemberHp} keyboardType="numeric"/>
                            <TouchableOpacity onPress={addMemberToTeam} style={{backgroundColor:'#FFD700', justifyContent:'center', paddingHorizontal:10, borderRadius:8}}><Ionicons name="add" size={24} color="#000"/></TouchableOpacity>
                        </View>
                    </View>
                )}

                {/* PARCEIROS (Para Individual/Hit) - COM LÓGICA DE SKILLS ATIVAS */}
                {newCategory !== 'equipe' && (
                  <View style={{marginTop:10, marginBottom:15, padding:10, backgroundColor:'#222', borderRadius:8}}>
                    <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                        <Text style={{color:'#fff', fontWeight:'bold'}}>Possui Parceiros/Invocações?</Text>
                        <TouchableOpacity onPress={() => setHasPartners(!hasPartners)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: hasPartners ? '#00B37E' : 'transparent'}}>
                            {!!hasPartners && <Ionicons name="checkmark" size={18} color="#fff" />}
                        </TouchableOpacity>
                    </View>
                    
                    {hasPartners && (
                      <View>
                        {partners.map((p, idx) => (
                           <View key={idx} style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:8, backgroundColor:'#2a2a2a', borderRadius:6, marginBottom:5}}>
                              <View>
                                <Text style={{color:'#fff', fontWeight:'bold'}}>{p.name}</Text>
                                <Text style={{color:'#777', fontSize:10}}>{p.has_life ? (p.life_type === 'hit' ? `${p.base_hp} Hits` : `${p.base_hp} HP`) : 'Sem Vida'} • {p.skills?.length || 0} Skills</Text>
                              </View>
                              <View style={{flexDirection: 'row'}}>
                                <TouchableOpacity onPress={()=>openEditPartner(idx)} style={{marginRight:10}}><Ionicons name="pencil" size={18} color="#FFD700"/></TouchableOpacity>
                                <TouchableOpacity onPress={()=>removePartner(idx)}><Ionicons name="trash" size={18} color="#ff4444"/></TouchableOpacity>
                              </View>
                           </View>
                        ))}
                        <TouchableOpacity onPress={openAddPartner} style={{flexDirection:'row', alignItems:'center', justifyContent:'center', padding:10, backgroundColor:'#333', borderRadius:6, marginTop:5}}>
                          <Ionicons name="add-circle" size={18} color="#FFD700" style={{marginRight:5}} />
                          <Text style={{color:'#FFD700', fontSize:12}}>Adicionar Parceiro</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}

                <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                    <Text style={{color:'#fff', fontWeight:'bold'}}>Possui Escudo Inicial?</Text>
                    <TouchableOpacity onPress={() => setHasShield(!hasShield)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: hasShield ? '#00B37E' : 'transparent'}}>
                        {!!hasShield && <Ionicons name="checkmark" size={18} color="#fff" />}
                    </TouchableOpacity>
                </View>
                {hasShield && (
                    <TextInput style={styles.input} placeholder="Quantidade de Escudo" placeholderTextColor="#555" value={shieldInput} onChangeText={setShieldInput} keyboardType="numeric"/>
                )}

                {/* SISTEMA DE NÍVEIS */}
                <View style={{marginTop: 10, padding: 10, backgroundColor: '#222', borderRadius: 8}}>
                    <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                        <Text style={{color:'#fff', fontWeight:'bold'}}>Possui Sistema de Nível?</Text>
                        <TouchableOpacity onPress={() => setHasLevelSystem(!hasLevelSystem)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: hasLevelSystem ? '#00B37E' : 'transparent'}}>
                            {!!hasLevelSystem && <Ionicons name="checkmark" size={18} color="#fff" />}
                        </TouchableOpacity>
                    </View>
                    {hasLevelSystem && (
                        <TextInput style={[styles.input, {marginBottom: 0}]} placeholder="Quantidade Máxima de Níveis" placeholderTextColor="#555" value={maxLevelsInput} onChangeText={setMaxLevelsInput} keyboardType="numeric"/>
                    )}
                </View>

                <Text style={[styles.sectionHeader, {marginTop:10}]}>IMAGEM DO PERSONAGEM</Text>
                <TouchableOpacity onPress={pickImage} style={styles.imagePickerBtn}>
                    {pickedImageUri ? <Image source={{ uri: pickedImageUri }} style={styles.imagePreview} /> : newImage ? <Image source={{ uri: newImage }} style={styles.imagePreview} /> : <View style={{alignItems:'center'}}><Ionicons name="image-outline" size={40} color="#777" /><Text style={{color:'#777', marginTop:5}}>Toque para selecionar</Text></View>}
                </TouchableOpacity>

                <Text style={[styles.sectionHeader, {marginTop:20}]}>BANNER DE DESAFIO (Para Mestres)</Text>
                <TouchableOpacity onPress={pickBanner} style={[styles.imagePickerBtn, {height: 100}]}>
                    {pickedBannerUri ? <Image source={{ uri: pickedBannerUri }} style={styles.imagePreview} /> : newBanner ? <Image source={{ uri: newBanner }} style={styles.imagePreview} /> : <View style={{alignItems:'center'}}><Ionicons name="flag-outline" size={30} color="#777" /><Text style={{color:'#777', marginTop:5}}>Selecionar Banner</Text></View>}
                </TouchableOpacity>

                {/* SKILLS FORM (DO PERSONAGEM PRINCIPAL) */}
                <Text style={[styles.sectionHeader, {marginTop:20}]}>
                    {newCategory === 'equipe' ? "ADICIONAR HABILIDADE GERAL (EQUIPE)" : "ADICIONAR HABILIDADE / TRANSFORMAÇÃO"}
                </Text>
                <View style={[styles.skillForm, editingSkillIndex !== null && {borderWidth:1, borderColor:'#FFD700', backgroundColor:'#2a2a20'}]}>
                    <Text style={{color:'#aaa', fontSize:12, marginBottom:5}}>
                        {editingSkillIndex !== null ? `EDITANDO: ${tempSkills[editingSkillIndex].name}` : "NOVA HABILIDADE"}
                    </Text>
                    <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Nome Skill" placeholderTextColor="#555" value={skillName} onChangeText={setSkillName}/>
                    <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Descrição" placeholderTextColor="#555" value={skillDesc} onChangeText={setSkillDesc}/>
                    
                    {hasLevelSystem && (
                        <TextInput 
                            style={[styles.input, {marginBottom:5, borderColor: '#00B37E', borderWidth: 1}]} 
                            placeholder="Desbloquear no Nível (Padrão: 1)" 
                            placeholderTextColor="#555" 
                            value={skillUnlockLevel} 
                            onChangeText={setSkillUnlockLevel} 
                            keyboardType="numeric"
                        />
                    )}

                    {skillType !== 'passive' && (<View><TextInput style={[styles.input, {marginBottom:10}]} placeholder="Custo" placeholderTextColor="#555" value={skillCost} onChangeText={setSkillCost}/><TextInput style={[styles.input, {marginBottom:10}]} placeholder="Duração (Vazio = Infinito)" placeholderTextColor="#555" value={skillDuration} onChangeText={setSkillDuration} keyboardType="numeric"/></View>)}
                    
                    <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}><Text style={{color:'#aaa', fontSize:12}}>Gera Escudo?</Text><TouchableOpacity onPress={() => setSkillGeneratesShield(!skillGeneratesShield)} style={{width:20, height:20, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: skillGeneratesShield ? '#FFD700' : 'transparent'}}>{!!skillGeneratesShield && <Ionicons name="checkmark" size={14} color="#000" />}</TouchableOpacity></View>
                    {skillGeneratesShield && (<TextInput style={[styles.input, {marginBottom:10}]} placeholder="Valor do Escudo" placeholderTextColor="#555" value={skillShieldValue} onChangeText={setSkillShieldValue} keyboardType="numeric"/>)}
                    <View style={{flexDirection:'row', justifyContent:'space-around', marginBottom:15}}><TouchableOpacity onPress={()=>setSkillType('active')} style={[styles.typeBadge, skillType==='active' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>Ativa</Text></TouchableOpacity><TouchableOpacity onPress={()=>setSkillType('passive')} style={[styles.typeBadge, skillType==='passive' && {backgroundColor:'#8257e5', borderColor:'#8257e5'}]}><Text style={styles.typeText}>Passiva</Text></TouchableOpacity><TouchableOpacity onPress={()=>setSkillType('transformation')} style={[styles.typeBadge, skillType==='transformation' && {backgroundColor:'#FFD700', borderColor:'#FFD700'}]}><Text style={[styles.typeText, skillType==='transformation' && {color:'black'}]}>Transform</Text></TouchableOpacity></View>
                    
                    {skillType === 'transformation' && (
                        <View>
                            <View style={{flexDirection:'row', alignItems:'center', marginBottom:10, justifyContent:'center'}}>
                                <Text style={{color:'#fff', marginRight:10, fontSize:12}}>Vida vira HITs?</Text>
                                <TouchableOpacity onPress={() => setSkillIsHitBased(!skillIsHitBased)} style={{width:20, height:20, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: skillIsHitBased ? '#ff4444' : 'transparent'}}>{!!skillIsHitBased && <Ionicons name="checkmark" size={14} color="#000" />}</TouchableOpacity>
                            </View>
                            {skillIsHitBased && (
                                <TextInput style={[styles.input, {borderColor:'#ff4444'}]} placeholder="Quantidade de Hits" placeholderTextColor="#555" value={skillHitValueInput} onChangeText={setSkillHitValueInput} keyboardType="numeric"/>
                            )}
                        </View>
                    )}

                    {(skillType === 'passive' || skillType === 'active') && (
                        <View>
                            <View style={{flexDirection:'row', justifyContent:'space-around', marginBottom:10}}>
                                <TouchableOpacity onPress={()=>skillType==='passive'?setPassiveCondition('normal'):setActiveCondition('normal')} style={[styles.typeBadge, (skillType==='passive'?passiveCondition:activeCondition)==='normal' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>NORMAL</Text></TouchableOpacity>
                                <TouchableOpacity onPress={()=>skillType==='passive'?setPassiveCondition('transformed'):setActiveCondition('transformed')} style={[styles.typeBadge, (skillType==='passive'?passiveCondition:activeCondition)==='transformed' && {backgroundColor:'#ff4444', borderColor:'#ff4444'}]}><Text style={styles.typeText}>TRANSFORMADO</Text></TouchableOpacity>
                            </View>
                            <View style={{flexDirection:'row', alignItems:'center', marginBottom:10, justifyContent:'center'}}>
                                <Text style={{color:'#fff', marginRight:10, fontSize:12}}>Afeta toda a equipe? (Geral)</Text>
                                <TouchableOpacity onPress={() => setIsSkillGeneral(!isSkillGeneral)} style={{width:20, height:20, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: isSkillGeneral ? '#FFD700' : 'transparent'}}>{!!isSkillGeneral && <Ionicons name="checkmark" size={14} color="#000" />}</TouchableOpacity>
                            </View>
                        </View>
                    )}

                    <View style={{flexDirection:'row', marginTop: 10}}>
                        <TouchableOpacity onPress={addSkillToTempList} style={[styles.saveButton, {flex: 1, marginTop:0, backgroundColor: editingSkillIndex !== null ? '#FFD700' : '#333', borderColor:'#555', borderWidth:1, marginRight: 5}]}>
                            <Text style={{color: editingSkillIndex !== null ? '#000' : '#fff', fontWeight:'bold'}}>
                                {editingSkillIndex !== null ? "SALVAR ALTERAÇÃO" : "+ Adicionar na Lista"}
                            </Text>
                        </TouchableOpacity>
                        {editingSkillIndex !== null && (
                            <TouchableOpacity onPress={clearSkillForm} style={[styles.saveButton, {marginTop:0, backgroundColor:'#ff4444', width: 40}]}>
                                <Ionicons name="close" size={20} color="#fff" />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
                
                {tempSkills.length > 0 && (<View style={{marginTop:15}}><Text style={{color:'#ccc', marginBottom:5}}>Lista de Habilidades ({tempSkills.length}):</Text>{tempSkills.map((s, index) => (<View key={index} style={styles.skillRow}><View style={{flex:1}}><Text style={{color:'#fff', fontWeight:'bold'}}>{s.is_hit_based ? '[HIT] ' : ''}{s.unlock_level && s.unlock_level > 1 ? `[Lv ${s.unlock_level}] ` : ''}{s.name}</Text><Text style={{color:'#777', fontSize:10}}>{s.description} {s.shield_value ? ` • Escudo: ${s.shield_value}` : ''}</Text>
                {(s.type === 'passive' || s.type === 'active') && (<View style={{marginTop:4, alignSelf:'flex-start', paddingHorizontal:6, paddingVertical:2, borderRadius:4, backgroundColor: getSubtypeColor(s.type==='passive'?s.passive_type:s.active_type)}}><Text style={{fontSize:8, fontWeight:'bold', color:'#000'}}>{getSubtypeLabel(s.type==='passive'?s.passive_type:s.active_type)}</Text></View>)}
                </View><View style={{flexDirection:'row'}}><TouchableOpacity onPress={() => handleEditSkill(index)} style={{marginRight: 15}}><Ionicons name="pencil" size={18} color="#FFD700" /></TouchableOpacity><TouchableOpacity onPress={() => removeSkillFromTemp(index)}><Ionicons name="trash" size={18} color="#ff4444" /></TouchableOpacity></View></View>))}</View>)}
                
                <View style={{height:20}} />
            </ScrollView>
            <View style={{marginTop:10}}>
                <TouchableOpacity onPress={handleSaveChar} style={styles.saveButton} disabled={saving}><Text style={styles.saveButtonText}>{saving ? "Salvando..." : (editingCharId ? "ATUALIZAR" : "CRIAR")}</Text></TouchableOpacity>
                <TouchableOpacity onPress={()=>{setCreateCharModalVisible(false); if(currentRoom) setLobbyModalVisible(true);}} style={[styles.saveButton,{backgroundColor:'#222', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* MEMBER SKILLS MODAL */}
      <Modal transparent visible={memberSkillsModalVisible} animationType="slide">
        <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, {backgroundColor:'#222'}]}>
                <Text style={styles.modalTitle}>Skills de: {currentMemberIndex !== null ? teamMembers[currentMemberIndex]?.name : '...'}</Text>
                
                <ScrollView>
                    <View style={[styles.skillForm, editingSkillIndex !== null && {borderWidth:1, borderColor:'#FFD700', backgroundColor:'#2a2a20'}]}>
                        <Text style={{color:'#aaa', fontSize:12, marginBottom:5}}>{editingSkillIndex !== null ? `EDITANDO: ${tempSkills[editingSkillIndex].name}` : "NOVA HABILIDADE"}</Text>
                        <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Nome Skill" placeholderTextColor="#555" value={skillName} onChangeText={setSkillName}/>
                        <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Descrição" placeholderTextColor="#555" value={skillDesc} onChangeText={setSkillDesc}/>
                        
                        {hasLevelSystem && (
                            <TextInput 
                                style={[styles.input, {marginBottom:5, borderColor: '#00B37E', borderWidth: 1}]} 
                                placeholder="Desbloquear no Nível (Padrão: 1)" 
                                placeholderTextColor="#555" 
                                value={skillUnlockLevel} 
                                onChangeText={setSkillUnlockLevel} 
                                keyboardType="numeric"
                            />
                        )}

                        {skillType !== 'passive' && (<View><TextInput style={[styles.input, {marginBottom:10}]} placeholder="Custo" placeholderTextColor="#555" value={skillCost} onChangeText={setSkillCost}/><TextInput style={[styles.input, {marginBottom:10}]} placeholder="Duração (Vazio = Infinito)" placeholderTextColor="#555" value={skillDuration} onChangeText={setSkillDuration} keyboardType="numeric"/></View>)}
                        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}><Text style={{color:'#aaa', fontSize:12}}>Gera Escudo?</Text><TouchableOpacity onPress={() => setSkillGeneratesShield(!skillGeneratesShield)} style={{width:20, height:20, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: skillGeneratesShield ? '#FFD700' : 'transparent'}}>{!!skillGeneratesShield && <Ionicons name="checkmark" size={14} color="#000" />}</TouchableOpacity></View>
                        {skillGeneratesShield && (<TextInput style={[styles.input, {marginBottom:10}]} placeholder="Valor do Escudo" placeholderTextColor="#555" value={skillShieldValue} onChangeText={setSkillShieldValue} keyboardType="numeric"/>)}
                        <View style={{flexDirection:'row', justifyContent:'space-around', marginBottom:15}}><TouchableOpacity onPress={()=>setSkillType('active')} style={[styles.typeBadge, skillType==='active' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>Ativa</Text></TouchableOpacity><TouchableOpacity onPress={()=>setSkillType('passive')} style={[styles.typeBadge, skillType==='passive' && {backgroundColor:'#8257e5', borderColor:'#8257e5'}]}><Text style={styles.typeText}>Passiva</Text></TouchableOpacity><TouchableOpacity onPress={()=>setSkillType('transformation')} style={[styles.typeBadge, skillType==='transformation' && {backgroundColor:'#FFD700', borderColor:'#FFD700'}]}><Text style={[styles.typeText, skillType==='transformation' && {color:'black'}]}>Transform</Text></TouchableOpacity></View>
                        
                        {skillType === 'transformation' && (
                            <View>
                                <View style={{flexDirection:'row', alignItems:'center', marginBottom:10, justifyContent:'center'}}>
                                    <Text style={{color:'#fff', marginRight:10, fontSize:12}}>Vida vira HITs?</Text>
                                    <TouchableOpacity onPress={() => setSkillIsHitBased(!skillIsHitBased)} style={{width:20, height:20, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: skillIsHitBased ? '#ff4444' : 'transparent'}}>{!!skillIsHitBased && <Ionicons name="checkmark" size={14} color="#000" />}</TouchableOpacity>
                                </View>
                                {skillIsHitBased && (
                                    <TextInput style={[styles.input, {borderColor:'#ff4444'}]} placeholder="Quantidade de Hits" placeholderTextColor="#555" value={skillHitValueInput} onChangeText={setSkillHitValueInput} keyboardType="numeric"/>
                                )}
                            </View>
                        )}

                        {(skillType === 'passive' || skillType === 'active') && (
                            <View>
                                <View style={{flexDirection:'row', justifyContent:'space-around', marginBottom:10}}>
                                    <TouchableOpacity onPress={()=>skillType==='passive'?setPassiveCondition('normal'):setActiveCondition('normal')} style={[styles.typeBadge, (skillType==='passive'?passiveCondition:activeCondition)==='normal' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>NORMAL</Text></TouchableOpacity>
                                    <TouchableOpacity onPress={()=>skillType==='passive'?setPassiveCondition('transformed'):setActiveCondition('transformed')} style={[styles.typeBadge, (skillType==='passive'?passiveCondition:activeCondition)==='transformed' && {backgroundColor:'#ff4444', borderColor:'#ff4444'}]}><Text style={styles.typeText}>TRANSFORMADO</Text></TouchableOpacity>
                                </View>
                                <View style={{flexDirection:'row', alignItems:'center', marginBottom:10, justifyContent:'center'}}>
                                    <Text style={{color:'#fff', marginRight:10, fontSize:12}}>Afeta toda a equipe? (Geral)</Text>
                                    <TouchableOpacity onPress={() => setIsSkillGeneral(!isSkillGeneral)} style={{width:20, height:20, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: isSkillGeneral ? '#FFD700' : 'transparent'}}>{!!isSkillGeneral && <Ionicons name="checkmark" size={14} color="#000" />}</TouchableOpacity>
                                </View>
                            </View>
                        )}

                        <View style={{flexDirection:'row', marginTop: 10}}>
                            <TouchableOpacity onPress={addSkillToTempList} style={[styles.saveButton, {flex: 1, marginTop:0, backgroundColor: editingSkillIndex !== null ? '#FFD700' : '#333', borderColor:'#555', borderWidth:1, marginRight: 5}]}>
                                <Text style={{color: editingSkillIndex !== null ? '#000' : '#fff', fontWeight:'bold'}}>
                                    {editingSkillIndex !== null ? "SALVAR ALTERAÇÃO" : "+ Adicionar Skill ao Membro"}
                                </Text>
                            </TouchableOpacity>
                             {editingSkillIndex !== null && (
                                <TouchableOpacity onPress={clearSkillForm} style={[styles.saveButton, {marginTop:0, backgroundColor:'#ff4444', width: 40}]}>
                                    <Ionicons name="close" size={20} color="#fff" />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                    
                    {tempSkills.length > 0 && (
                        <View style={{marginTop:15}}>
                            <Text style={{color:'#ccc', marginBottom:5}}>Skills Adicionadas:</Text>
                            {tempSkills.map((s, index) => (
                                <View key={index} style={styles.skillRow}>
                                    <View style={{flex:1}}>
                                        <Text style={{color:'#fff', fontWeight:'bold'}}>{s.is_hit_based ? '[HIT] ' : ''}{s.unlock_level && s.unlock_level > 1 ? `[Lv ${s.unlock_level}] ` : ''}{s.name}</Text>
                                        <Text style={{color:'#777', fontSize:10}}>{s.description}</Text>
                                        {(s.type === 'passive' || s.type === 'active') && (
                                            <View style={{marginTop:4, alignSelf:'flex-start', paddingHorizontal:6, paddingVertical:2, borderRadius:4, backgroundColor: getSubtypeColor(s.type==='passive'?s.passive_type:s.active_type)}}>
                                                <Text style={{fontSize:8, fontWeight:'bold', color:'#000'}}>{getSubtypeLabel(s.type==='passive'?s.passive_type:s.active_type)}</Text>
                                            </View>
                                        )}
                                    </View>
                                    <View style={{flexDirection:'row'}}>
                                        <TouchableOpacity onPress={() => handleEditSkill(index)} style={{marginRight: 15}}><Ionicons name="pencil" size={18} color="#FFD700" /></TouchableOpacity>
                                        <TouchableOpacity onPress={() => removeSkillFromTemp(index)}><Ionicons name="trash" size={18} color="#ff4444" /></TouchableOpacity>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}
                </ScrollView>
                <TouchableOpacity onPress={closeMemberSkills} style={styles.saveButton}><Text style={styles.saveButtonText}>CONCLUIR SKILLS</Text></TouchableOpacity>
            </View>
        </View>
      </Modal>

      {/* PARTNER CREATION MODAL */}
      <Modal transparent visible={partnerModalVisible} animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
            <View style={[styles.modalContent, {maxHeight: '90%'}]}>
                <Text style={styles.modalTitle}>{editingPartnerIndex !== null ? "Editar Parceiro" : "Novo Parceiro"}</Text>
                <ScrollView contentContainerStyle={{paddingBottom: 20}}>
                    <TextInput style={styles.input} placeholder="Nome do Parceiro" placeholderTextColor="#555" value={partnerName} onChangeText={setPartnerName}/>
                    <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:15}}><Text style={{color:'#fff'}}>Possui Vida?</Text><TouchableOpacity onPress={() => setPartnerHasLife(!partnerHasLife)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: partnerHasLife ? '#00B37E' : 'transparent'}}>{!!partnerHasLife && <Ionicons name="checkmark" size={18} color="#fff" />}</TouchableOpacity></View>
                    {partnerHasLife && (<View style={{marginBottom:15}}><View style={{flexDirection:'row', marginBottom:10}}><TouchableOpacity onPress={()=>setPartnerLifeType('numeric')} style={[styles.typeBadge, partnerLifeType==='numeric' && {backgroundColor:'#00B37E'}]}><Text style={styles.typeText}>HP Numérico</Text></TouchableOpacity><TouchableOpacity onPress={()=>setPartnerLifeType('hit')} style={[styles.typeBadge, partnerLifeType==='hit' && {backgroundColor:'#ff4444'}]}><Text style={styles.typeText}>HITs</Text></TouchableOpacity></View><TextInput style={styles.input} placeholder={partnerLifeType === 'hit' ? "Qtd Hits" : "Vida Máxima"} placeholderTextColor="#555" value={partnerHpInput} onChangeText={setPartnerHpInput} keyboardType="numeric"/></View>)}
                    <View style={{marginTop: 10, padding: 10, backgroundColor: '#2a2a20', borderRadius: 8, marginBottom: 15}}><View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}><Text style={{color:'#fff', fontWeight:'bold'}}>Possui Sistema de Nível?</Text><TouchableOpacity onPress={() => setPartnerHasLevelSystem(!partnerHasLevelSystem)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: partnerHasLevelSystem ? '#00B37E' : 'transparent'}}>{!!partnerHasLevelSystem && <Ionicons name="checkmark" size={18} color="#fff" />}</TouchableOpacity></View>{partnerHasLevelSystem && (<TextInput style={[styles.input, {marginBottom: 0}]} placeholder="Nível Máximo" placeholderTextColor="#555" value={partnerMaxLevelsInput} onChangeText={setPartnerMaxLevelsInput} keyboardType="numeric"/>)}</View>
                    
                    <Text style={[styles.sectionHeader, {marginTop:10}]}>Habilidades do Parceiro</Text>
                    <View style={[styles.skillForm, editingPartnerSkillIndex !== null && {borderWidth:1, borderColor:'#FFD700', backgroundColor:'#2a2a20'}]}>
                        <Text style={{color:'#aaa', fontSize:12, marginBottom:5}}>{editingPartnerSkillIndex !== null ? "Editando Skill" : "Nova Skill"}</Text>
                        <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Nome Skill" placeholderTextColor="#555" value={skillName} onChangeText={setSkillName}/>
                        <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Descrição" placeholderTextColor="#555" value={skillDesc} onChangeText={setSkillDesc}/>
                        {partnerHasLevelSystem && (<TextInput style={[styles.input, {marginBottom:5, borderColor: '#00B37E', borderWidth: 1}]} placeholder="Desbloquear no Nível (Padrão: 1)" placeholderTextColor="#555" value={skillUnlockLevel} onChangeText={setSkillUnlockLevel} keyboardType="numeric"/>)}
                        {skillType !== 'passive' && (<TextInput style={[styles.input, {marginBottom:10}]} placeholder="Custo" placeholderTextColor="#555" value={skillCost} onChangeText={setSkillCost}/>)}
                        {skillType !== 'passive' && (<TextInput style={[styles.input, {marginBottom:10}]} placeholder="Duração" placeholderTextColor="#555" value={skillDuration} onChangeText={setSkillDuration} keyboardType="numeric"/>)}
                        
                        {/* SELETOR DE TIPO (CORRIGIDO PARA PERMITIR ATIVA EM PARCEIROS) */}
                        <View style={{flexDirection:'row', justifyContent:'space-around', marginBottom:10}}>
                            <TouchableOpacity onPress={()=>setSkillType('active')} style={[styles.typeBadge, skillType==='active' && {backgroundColor:'#00B37E'}]}><Text style={styles.typeText}>Ativa</Text></TouchableOpacity>
                            <TouchableOpacity onPress={()=>setSkillType('passive')} style={[styles.typeBadge, skillType==='passive' && {backgroundColor:'#8257e5'}]}><Text style={styles.typeText}>Passiva</Text></TouchableOpacity>
                            <TouchableOpacity onPress={()=>setSkillType('transformation')} style={[styles.typeBadge, skillType==='transformation' && {backgroundColor:'#FFD700'}]}><Text style={[styles.typeText, {color:'white'}]}>Transform</Text></TouchableOpacity>
                        </View>
                        
                        {skillType === 'transformation' && (<View><View style={{flexDirection:'row', alignItems:'center', marginBottom:10, justifyContent:'center'}}><Text style={{color:'#fff', marginRight:10, fontSize:12}}>Vida vira HITs?</Text><TouchableOpacity onPress={() => setSkillIsHitBased(!skillIsHitBased)} style={{width:20, height:20, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: skillIsHitBased ? '#ff4444' : 'transparent'}}>{!!skillIsHitBased && <Ionicons name="checkmark" size={14} color="#000" />}</TouchableOpacity></View>{skillIsHitBased && (<TextInput style={[styles.input, {borderColor:'#ff4444'}]} placeholder="Quantidade de Hits" placeholderTextColor="#555" value={skillHitValueInput} onChangeText={setSkillHitValueInput} keyboardType="numeric"/>)}</View>)}
                        <TouchableOpacity onPress={addPartnerSkill} style={[styles.saveButton, {marginTop:0, backgroundColor: editingPartnerSkillIndex !== null ? '#FFD700' : '#333', borderWidth:1, borderColor:'#555'}]}><Text style={{color: editingPartnerSkillIndex !== null ? '#000' : '#fff', fontWeight:'bold'}}>{editingPartnerSkillIndex !== null ? "Salvar Skill" : "+ Adicionar Skill"}</Text></TouchableOpacity>
                    </View>
                    
                    {partnerSkills.length > 0 && (<View style={{marginTop:10}}>{partnerSkills.map((s, idx) => (<View key={idx} style={{padding:8, backgroundColor:'#333', marginBottom:5, borderRadius:6, flexDirection:'row', justifyContent:'space-between'}}>
                      <View style={{flex:1}}>
                        <Text style={{color:'#fff', fontWeight:'bold'}}>{s.unlock_level && s.unlock_level > 1 ? `[Lv ${s.unlock_level}] ` : ''}{s.name}</Text>
                        <View style={{flexDirection:'row', alignItems:'center'}}>
                           <Text style={{color:'#aaa', fontSize:10, marginRight: 5}}>{s.type.toUpperCase()}</Text>
                           {s.type === 'active' && <Ionicons name="flash" size={10} color="#00B37E" />}
                           {s.type === 'passive' && <Ionicons name="shield-checkmark" size={10} color="#8257e5" />}
                        </View>
                      </View>
                      <View style={{flexDirection: 'row'}}><TouchableOpacity onPress={() => handleEditPartnerSkill(idx)} style={{marginRight:10}}><Ionicons name="pencil" size={16} color="#FFD700" /></TouchableOpacity><TouchableOpacity onPress={() => removePartnerSkill(idx)}><Ionicons name="trash" size={16} color="#ff4444" /></TouchableOpacity></View></View>))}</View>)}
                </ScrollView>
                <View style={{marginTop: 10, paddingBottom: 10}}><TouchableOpacity onPress={savePartner} style={styles.saveButton}><Text style={styles.saveButtonText}>{editingPartnerIndex !== null ? "ATUALIZAR PARCEIRO" : "CRIAR PARCEIRO"}</Text></TouchableOpacity><TouchableOpacity onPress={()=>setPartnerModalVisible(false)} style={[styles.saveButton, {backgroundColor:'#333', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity></View>
            </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EVENT MODAL ATUALIZADO (Checks Boss/Vida) */}
      <Modal transparent visible={createEventModalVisible} animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
            <View style={[styles.modalContent, {maxHeight: '90%'}]}>
                <Text style={styles.modalTitle}>{editingEventId ? "Editar Evento" : "Criar Evento"}</Text>
                <ScrollView contentContainerStyle={{paddingBottom: 20}}>
                    <TouchableOpacity onPress={pickEventImage} style={[styles.imagePickerBtn, {height:120}]}>
                        {pickedEventImageUri ? (<Image source={{uri:pickedEventImageUri}} style={styles.imagePreview}/>) : newEventImage ? (<Image source={{uri:newEventImage}} style={styles.imagePreview}/>) : (<View style={{alignItems:'center'}}><Ionicons name="image" size={30} color="#777"/><Text style={{color:'#777', marginTop:5}}>Capa do Evento</Text></View>)}
                    </TouchableOpacity>
                    <TextInput style={styles.input} placeholder="Título do Evento" placeholderTextColor="#555" value={newEventTitle} onChangeText={setNewEventTitle}/>
                    <TextInput style={[styles.input, {height:80, textAlignVertical:'top'}]} placeholder="Descrição / Narrativa" placeholderTextColor="#555" value={newEventDesc} onChangeText={setNewEventDesc} multiline/>
                    
                    {/* LISTA DE PERSONAGENS DO EVENTO */}
                    <Text style={[styles.sectionHeader, {marginTop:15}]}>Inimigos / Bosses</Text>
                    {eventCharacters.length === 0 ? (
                        <Text style={{color:'#777', fontStyle:'italic', marginBottom:10}}>Nenhum inimigo adicionado.</Text>
                    ) : (
                        eventCharacters.map((char, idx) => (
                            <View key={idx} style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:10, backgroundColor:'#2a2a20', borderRadius:6, marginBottom:5, borderLeftWidth:4, borderLeftColor: char.is_boss ? '#ff4444' : '#777'}}>
                                <View>
                                    <Text style={{color:'#fff', fontWeight:'bold'}}>{char.name} {char.is_boss ? '(BOSS)' : ''}</Text>
                                    <Text style={{color:'#aaa', fontSize:10}}>{char.base_hp} HP • {char.skills?.length || 0} Skills</Text>
                                </View>
                                <View style={{flexDirection:'row'}}>
                                    <TouchableOpacity onPress={()=>openEditEventChar(idx)} style={{marginRight:10}}><Ionicons name="pencil" size={18} color="#FFD700" /></TouchableOpacity>
                                    <TouchableOpacity onPress={()=>removeEventChar(idx)}><Ionicons name="trash" size={18} color="#ff4444" /></TouchableOpacity>
                                </View>
                            </View>
                        ))
                    )}
                    
                    <TouchableOpacity onPress={openAddEventChar} style={[styles.saveButton, {marginTop:5, backgroundColor:'#333', borderWidth:1, borderColor:'#00B37E'}]}>
                        <Text style={{color:'#00B37E', fontWeight:'bold'}}>+ Adicionar Personagem</Text>
                    </TouchableOpacity>

                </ScrollView>
                <View style={{marginTop: 10}}>
                    <TouchableOpacity onPress={handleSaveEvent} style={styles.saveButton} disabled={saving}><Text style={styles.saveButtonText}>{saving ? "Salvando..." : "SALVAR EVENTO"}</Text></TouchableOpacity>
                    <TouchableOpacity onPress={()=>setCreateEventModalVisible(false)} style={[styles.saveButton,{backgroundColor:'#333', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity>
                </View>
            </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* SUB-MODAL: PERSONAGEM DO EVENTO */}
      <Modal transparent visible={createEventCharModalVisible} animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
            <View style={[styles.modalContent, {maxHeight: '90%'}]}>
                <Text style={styles.modalTitle}>{editingEventCharIndex !== null ? "Editar Inimigo" : "Novo Inimigo"}</Text>
                <ScrollView contentContainerStyle={{paddingBottom: 20}}>
                    <TextInput style={styles.input} placeholder="Nome do Inimigo" placeholderTextColor="#555" value={evCharName} onChangeText={setEvCharName}/>
                    
                    <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:15, marginTop:5}}>
                        <View style={{flexDirection:'row', alignItems:'center'}}>
                           <Text style={{color:'#fff', marginRight:10, fontWeight:'bold'}}>Possui Vida?</Text>
                           <TouchableOpacity onPress={() => setEvCharHasLife(!evCharHasLife)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: evCharHasLife ? '#00B37E' : 'transparent'}}>{!!evCharHasLife && <Ionicons name="checkmark" size={18} color="#fff" />}</TouchableOpacity>
                        </View>
                        <View style={{flexDirection:'row', alignItems:'center'}}>
                           <Text style={{color:'#fff', marginRight:10, fontWeight:'bold'}}>É um Boss?</Text>
                           <TouchableOpacity onPress={() => setEvCharIsBoss(!evCharIsBoss)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: evCharIsBoss ? '#ff4444' : 'transparent'}}>{!!evCharIsBoss && <Ionicons name="checkmark" size={18} color="#fff" />}</TouchableOpacity>
                        </View>
                    </View>

                    {evCharHasLife && (
                        <TextInput style={styles.input} placeholder="HP Total" placeholderTextColor="#555" value={evCharHp} onChangeText={setEvCharHp} keyboardType="numeric"/>
                    )}

                    {/* SKILLS DO PERSONAGEM DO EVENTO */}
                    <Text style={[styles.sectionHeader, {marginTop:10}]}>Habilidades / Passivas</Text>
                    
                    {/* Reutilizando o Form de Skill Genérico */}
                    <View style={[styles.skillForm, editingEvCharSkillIndex !== null && {borderWidth:1, borderColor:'#FFD700', backgroundColor:'#2a2a20'}]}>
                        <Text style={{color:'#aaa', fontSize:12, marginBottom:5}}>{editingEvCharSkillIndex !== null ? "Editando Habilidade" : "Nova Habilidade"}</Text>
                        <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Nome Skill" placeholderTextColor="#555" value={skillName} onChangeText={setSkillName}/>
                        <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Descrição" placeholderTextColor="#555" value={skillDesc} onChangeText={setSkillDesc}/>
                        
                        {/* SELETOR DE MODO (NORMAL / BOSS MODE) - SÓ APARECE SE FOR BOSS */}
                        {evCharIsBoss && (
                            <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}>
                                <TouchableOpacity onPress={()=>setSkillCombatState('normal')} style={[styles.typeBadge, skillCombatState==='normal' && {backgroundColor:'#00B37E'}]}><Text style={styles.typeText}>Combate Normal</Text></TouchableOpacity>
                                <TouchableOpacity onPress={()=>setSkillCombatState('boss')} style={[styles.typeBadge, skillCombatState==='boss' && {backgroundColor:'#ff4444'}]}><Text style={styles.typeText}>Modo Boss/Fúria</Text></TouchableOpacity>
                            </View>
                        )}

                        <View style={{flexDirection:'row', justifyContent:'space-around', marginBottom:10}}>
                            <TouchableOpacity onPress={()=>setSkillType('active')} style={[styles.typeBadge, skillType==='active' && {backgroundColor:'#00B37E'}]}><Text style={styles.typeText}>Ativa</Text></TouchableOpacity>
                            <TouchableOpacity onPress={()=>setSkillType('passive')} style={[styles.typeBadge, skillType==='passive' && {backgroundColor:'#8257e5'}]}><Text style={styles.typeText}>Passiva</Text></TouchableOpacity>
                            <TouchableOpacity onPress={()=>setSkillType('transformation')} style={[styles.typeBadge, skillType==='transformation' && {backgroundColor:'#FFD700'}]}><Text style={[styles.typeText, {color:'white'}]}>Transform</Text></TouchableOpacity>
                        </View>

                        {skillType !== 'passive' && (
                            <View style={{flexDirection:'row'}}>
                                <TextInput style={[styles.input, {flex:1, marginRight:5}]} placeholder="Custo" placeholderTextColor="#555" value={skillCost} onChangeText={setSkillCost}/>
                                <TextInput style={[styles.input, {flex:1}]} placeholder="Duração" placeholderTextColor="#555" value={skillDuration} onChangeText={setSkillDuration} keyboardType="numeric"/>
                            </View>
                        )}

                        <TouchableOpacity onPress={addEvCharSkill} style={[styles.saveButton, {marginTop:0, backgroundColor: editingEvCharSkillIndex !== null ? '#FFD700' : '#333', borderWidth:1, borderColor:'#555'}]}>
                            <Text style={{color: editingEvCharSkillIndex !== null ? '#000' : '#fff', fontWeight:'bold'}}>{editingEvCharSkillIndex !== null ? "Salvar Skill" : "+ Adicionar Skill"}</Text>
                        </TouchableOpacity>
                    </View>

                    {/* LISTA DE SKILLS */}
                    {evCharSkills.map((s, idx) => (
                        <View key={idx} style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:10, backgroundColor:'#333', borderRadius:6, marginBottom:5, borderLeftWidth:4, borderLeftColor: s.combat_state === 'boss' ? '#ff4444' : (s.type === 'active' ? '#00B37E' : '#8257e5')}}>
                            <View style={{flex:1}}>
                                <Text style={{color:'#fff', fontWeight:'bold'}}>{s.name}</Text>
                                <Text style={{color:'#aaa', fontSize:11}}>{s.description}</Text>
                                <View style={{flexDirection:'row', marginTop:2}}>
                                    <Text style={{color: '#aaa', fontSize:10, marginRight: 5}}>{s.type.toUpperCase()}</Text>
                                    {/* SÓ MOSTRA O MODO SE FOR BOSS, SENÃO É SEMPRE NORMAL IMPLÍCITO */}
                                    {evCharIsBoss && (
                                        <Text style={{color: s.combat_state==='boss' ? '#ff4444' : '#00B37E', fontSize:10, fontWeight:'bold'}}>[{s.combat_state?.toUpperCase()}]</Text>
                                    )}
                                </View>
                            </View>
                            <View style={{flexDirection:'row'}}>
                                <TouchableOpacity onPress={()=>handleEditEvCharSkill(idx)} style={{marginRight:10}}>
                                    <Ionicons name="pencil" size={18} color="#FFD700" />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={()=>removeEvCharSkill(idx)}>
                                    <Ionicons name="trash" size={18} color="#ff4444" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))}
                </ScrollView>
                <View style={{marginTop: 10}}>
                    <TouchableOpacity onPress={saveEventChar} style={styles.saveButton}><Text style={styles.saveButtonText}>SALVAR INIMIGO</Text></TouchableOpacity>
                    <TouchableOpacity onPress={()=>setCreateEventCharModalVisible(false)} style={[styles.saveButton,{backgroundColor:'#333', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity>
                </View>
            </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal transparent visible={manageEventsModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Eventos</Text><TouchableOpacity onPress={openCreateEventModal}><Ionicons name="add-circle" size={28} color="#00B37E"/></TouchableOpacity><TouchableOpacity onPress={()=>setManageEventsModalVisible(false)}><Ionicons name="close" size={24} color="#ccc"/></TouchableOpacity></View><FlatList data={catalogEvents} keyExtractor={i=>i.id} renderItem={({item})=>(<View style={styles.catalogItem}><View style={{flex:1}}><Text style={styles.catalogName}>{item.title}</Text></View><TouchableOpacity onPress={()=>openEditEventModal(item)} style={{marginRight:15}}><Ionicons name="pencil" size={20} color="#8257e5"/></TouchableOpacity><TouchableOpacity onPress={()=>deleteEvent(item.id)}><Ionicons name="trash" size={20} color="red"/></TouchableOpacity></View>)}/></View></View></Modal>
      <Modal transparent visible={manageEffectsModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Buffs & Debuffs</Text><TouchableOpacity onPress={openCreateEffectModal}><Ionicons name="add-circle" size={28} color="#00B37E"/></TouchableOpacity><TouchableOpacity onPress={()=>setManageEffectsModalVisible(false)}><Ionicons name="close" size={24} color="#ccc"/></TouchableOpacity></View><FlatList data={catalogEffects} keyExtractor={i=>i.id} renderItem={({item})=>(<View style={styles.catalogItem}><View style={{flex:1}}><Text style={[styles.catalogName, {color: item.type==='buff'?'#00B37E':'#ff4444'}]}>{item.title}</Text><Text style={styles.catalogOrigin}>{item.type.toUpperCase()}{item.duration ? ` • ${item.duration} Rnds` : ''}</Text></View><TouchableOpacity onPress={()=>openEditEffectModal(item)} style={{marginRight:15}}><Ionicons name="pencil" size={20} color="#8257e5"/></TouchableOpacity><TouchableOpacity onPress={()=>deleteEffect(item.id)}><Ionicons name="trash" size={20} color="red"/></TouchableOpacity></View>)}/></View></View></Modal>
      <Modal transparent visible={createEffectModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>{editingEffectId ? "Editar Efeito" : "Criar Efeito"}</Text><View style={{flexDirection:'row', marginBottom:15}}><TouchableOpacity onPress={()=>setEffectType('buff')} style={[styles.typeBadge, effectType==='buff' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>BUFF (Bom)</Text></TouchableOpacity><TouchableOpacity onPress={()=>setEffectType('debuff')} style={[styles.typeBadge, effectType==='debuff' && {backgroundColor:'#ff4444', borderColor:'#ff4444'}]}><Text style={styles.typeText}>DEBUFF (Ruim)</Text></TouchableOpacity></View><TextInput style={styles.input} placeholder="Título (Ex: Veneno)" placeholderTextColor="#555" value={effectTitle} onChangeText={setEffectTitle}/><TextInput style={styles.input} placeholder="Descrição" placeholderTextColor="#555" value={effectDesc} onChangeText={setEffectDesc}/><TextInput style={styles.input} placeholder="Duração" placeholderTextColor="#555" value={effectDuration} onChangeText={setEffectDuration} keyboardType="numeric"/>{effectType === 'debuff' && (<TextInput style={[styles.input, {borderColor:'#ff4444'}]} placeholder="Dano (Ex: 10)" placeholderTextColor="#555" value={effectDamage} onChangeText={setEffectDamage}/>)}<TouchableOpacity onPress={handleSaveEffect} style={styles.saveButton}><Text style={styles.saveButtonText}>SALVAR</Text></TouchableOpacity><TouchableOpacity onPress={()=>setCreateEffectModalVisible(false)} style={[styles.saveButton,{backgroundColor:'#333', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity></View></View></Modal>
      <Modal animationType="fade" transparent={true} visible={detailsModalVisible} onRequestClose={() => setDetailsModalVisible(false)}><View style={styles.modalOverlay}><View style={[styles.modalContent, { height: '65%' }]}>{selectedCharacter ? (<View style={{alignItems: 'center'}}>{selectedCharacter.game_characters?.image_url ? <Image source={{uri: selectedCharacter.game_characters.image_url}} style={styles.detailsImageBig} /> : <View style={styles.detailsIconBig}><Text style={{fontSize: 40}}>👤</Text></View>}<Text style={styles.detailsTitle}>{selectedCharacter.game_characters?.name || 'Desconhecido'}</Text><Text style={styles.detailsClass}>{selectedCharacter.game_characters?.base_class}</Text><Text style={[styles.detailsClass, {color: getCategoryColor(selectedCharacter.game_characters?.category), marginTop:5}]}>{selectedCharacter.game_characters?.category?.toUpperCase() || 'INDIVIDUAL'}</Text><View style={styles.levelBigBadge}><Text style={styles.levelLabel}>HP BASE: {selectedCharacter.game_characters?.base_hp}</Text>{(selectedCharacter.game_characters?.base_shield || 0) > 0 && <Text style={[styles.levelLabel, {color:'#44aaff', marginTop:5}]}>ESCUDO: {selectedCharacter.game_characters?.base_shield}</Text>}</View><View style={styles.statsRow}><View style={styles.statBox}><Ionicons name="trophy" size={24} color="#FFD700" /><Text style={styles.statValue}>{selectedCharStats.wins}</Text><Text style={styles.statLabel}>Vitórias (Lv)</Text></View><View style={styles.statBox}><Ionicons name="game-controller" size={24} color="#ccc" /><Text style={styles.statValue}>{selectedCharStats.matches}</Text><Text style={styles.statLabel}>Partidas</Text></View><View style={styles.statBox}><Ionicons name="pie-chart" size={24} color="#8257e5" /><Text style={styles.statValue}>{selectedCharStats.winRate}%</Text><Text style={styles.statLabel}>Taxa</Text></View></View><View style={{flexDirection:'row', alignItems:'center', marginTop:20, backgroundColor:'#222', padding:10, borderRadius:8, width:'100%'}}><Text style={{color:'#fff', flex:1, fontSize:14, marginRight:10}}>Desafio do Personagem Concluído?</Text><TouchableOpacity onPress={() => handleToggleChallenge(selectedCharacter)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: selectedCharacter.challenge_completed ? '#00B37E' : 'transparent'}}>{!!selectedCharacter.challenge_completed && <Ionicons name="checkmark" size={18} color="#fff" />}</TouchableOpacity></View>{!!loadingStats && <ActivityIndicator size="small" color="#8257e5" style={{marginTop:10}}/>}<TouchableOpacity style={styles.closeButton} onPress={() => setDetailsModalVisible(false)}><Text style={styles.closeButtonText}>Fechar</Text></TouchableOpacity></View>) : <ActivityIndicator size="large" color="#8257e5"/>}</View></View></Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121214', paddingTop: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, paddingHorizontal: 20 },
  greeting: { color: '#E1E1E6', fontSize: 20, fontWeight: 'bold' },
  userEmail: { color: '#7C7C8A', fontSize: 12 },
  logoutButton: { padding: 8, backgroundColor: '#202024', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  loading: { flex: 1, backgroundColor: '#121214', justifyContent:'center', alignItems:'center' },
  
  // Scroll e Containers
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 }, 
  matchmakingContainer: { backgroundColor: '#202024', padding: 20, borderRadius: 12, marginBottom: 25 },
  
  // Botões de Jogo/Home
  newGameButton: { backgroundColor: '#8257e5', borderRadius: 8, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  newGameIcon: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 10, borderRadius: 50, marginRight: 15 },
  newGameTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  newGameSubtitle: { color: '#E0D1FF', fontSize: 12 },
  
  // Join
  joinContainer: { flexDirection: 'row' },
  joinInput: { flex: 1, backgroundColor: '#121214', color: '#fff', borderRadius: 8, paddingHorizontal: 15, marginRight: 10, borderWidth: 1, borderColor: '#333', textAlign: 'center', fontSize: 18, fontWeight: 'bold' },
  joinButton: { backgroundColor: '#00B37E', borderRadius: 8, justifyContent: 'center', paddingHorizontal: 20 },
  joinButtonText: { color: '#fff', fontWeight: 'bold' },
  
  // Lobby
  lobbyContainer: { flex: 1, backgroundColor: '#121214', padding: 20, paddingTop: 60 },
  lobbyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 },
  lobbyTitle: { color: '#fff', fontSize: 28, fontWeight: 'bold', letterSpacing: 2 },
  phaseTitle: { color: '#E1E1E6', fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  participantsList: { width: '100%', marginBottom: 30 },
  participantRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#202024', padding: 15, borderRadius: 8, marginBottom: 10 },
  participantName: { color: '#fff', marginLeft: 10, fontSize: 16 },
  actionButton: { backgroundColor: '#8257e5', padding: 20, borderRadius: 8, width: '100%', alignItems: 'center' },
  actionButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  
  // Botões de Ação (Criar Char, etc)
  actionsRow: { flexDirection: 'row', marginBottom: 25 },
  createButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', padding: 15, borderWidth: 1, borderColor: '#8257e5', borderRadius: 12 },
  createButtonText: { color: '#8257e5', fontWeight: 'bold', fontSize: 12 },
  
  // Listas e Cards
  sectionTitle: { color: '#E1E1E6', fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
  emptyText: { color: '#7C7C8A', marginTop: 10 },
  card: { backgroundColor: '#202024', padding: 12, borderRadius: 8, flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  charIcon: { width: 45, height: 45, borderRadius: 22.5, alignItems: 'center', justifyContent: 'center', marginRight: 15 },
  charImage: { width: 45, height: 45, borderRadius: 22.5, marginRight: 15, backgroundColor: '#333' },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cardSubtitle: { color: '#7C7C8A', fontSize: 12 },
  
  // Modais Genéricos
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#18181B', borderRadius: 24, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  input: { backgroundColor: '#27272A', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#3F3F46' },
  saveButton: { backgroundColor: '#00875F', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  saveButtonText: { color: '#fff', fontWeight: 'bold' },
  
  // Itens de Catálogo (Eventos/Efeitos)
  catalogItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#333' },
  catalogImage: { width: 40, height: 40, borderRadius: 20, marginRight: 12, backgroundColor: '#333' },
  catalogInfo: { flex: 1 },
  catalogName: { color: '#fff', fontWeight: 'bold' },
  catalogOrigin: { color: '#888', fontSize: 12 },
  
  // Detalhes do Personagem
  detailsImageBig: { width: 100, height: 100, borderRadius: 50, marginBottom: 15, backgroundColor: '#333' },
  detailsIconBig: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#29292E', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  detailsTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  detailsClass: { color: '#8257e5', fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase' },
  levelBigBadge: { marginTop: 20, alignItems: 'center', backgroundColor: '#3e2e6b', paddingVertical: 10, paddingHorizontal: 30, borderRadius: 12 },
  levelLabel: { color: '#D8B4FE', fontSize: 12, fontWeight: 'bold' },
  levelValue: { color: '#fff', fontSize: 36, fontWeight: 'bold' },
  closeButton: { backgroundColor: '#333', padding: 15, borderRadius: 8, marginTop: 20, width: '100%', alignItems: 'center' },
  closeButtonText: { color: '#fff' },
  
  // Formulários de Skills
  sectionHeader: { color:'#8257e5', fontWeight:'bold', fontSize:12, marginBottom:10, letterSpacing:1 },
  skillForm: { backgroundColor:'#202024', padding:10, borderRadius:8 },
  typeBadge: { borderWidth:1, borderColor:'#555', padding:8, borderRadius:20, flex:1, marginHorizontal:2, alignItems:'center' },
  typeText: { color:'#fff', fontSize:10, fontWeight:'bold' },
  skillRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:10, borderBottomWidth:1, borderBottomColor:'#333' },
  
  // Imagens
  imagePickerBtn: { width:'100%', height:150, backgroundColor:'#222', borderRadius:8, alignItems:'center', justifyContent:'center', borderStyle:'dashed', borderWidth:1, borderColor:'#555', marginBottom:20 },
  imagePreview: { width:'100%', height:'100%', borderRadius:8, resizeMode:'cover' },
  
  // Estatísticas
  historyCard: { backgroundColor: '#202024', padding: 15, borderRadius: 12, marginBottom: 15, borderLeftWidth: 4, borderLeftColor: '#FFD700' },
  statsRow: { flexDirection:'row', justifyContent:'space-around', width:'100%', marginTop:25 },
  statBox: { alignItems:'center', backgroundColor:'#222', padding:10, borderRadius:8, width:'30%' },
  statValue: { color:'#fff', fontWeight:'bold', fontSize:18, marginTop:5 },
  statLabel: { color:'#777', fontSize:10 }
});