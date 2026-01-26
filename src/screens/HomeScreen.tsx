// src/screens/HomeScreen.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ScrollView, 
  RefreshControl, Alert, Modal, FlatList, TextInput, Image, KeyboardAvoidingView, Platform, ActivityIndicator 
} from 'react-native';
import { supabase } from '../lib/supabase';
// Certifique-se de que todos os tipos estão exportados no rpg.ts
import { UserRosterItem, GameCharacter, Victory, GameEvent, Room, RoomParticipant, CharacterSkill, StatusEffect, TeamMember, TeamMemberState, MatchHistoryItem } from '../types/rpg';
import { Ionicons } from '@expo/vector-icons'; 
import { RealtimeChannel } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker'; 
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer'; 

interface HomeScreenProps {
  onStartGame: (roomCode: string) => void;
}

const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

interface GameCharacterWithCreator extends GameCharacter { 
  created_by?: string; 
  challenge_banner_url?: string; 
}

export default function HomeScreen({ onStartGame }: HomeScreenProps) {
  // --- DADOS GERAIS ---
  const [playedCharacters, setPlayedCharacters] = useState<UserRosterItem[]>([]);
  const [catalogChars, setCatalogChars] = useState<GameCharacterWithCreator[]>([]);
  const [catalogEvents, setCatalogEvents] = useState<GameEvent[]>([]);
  const [catalogEffects, setCatalogEffects] = useState<StatusEffect[]>([]); 
  const [victories, setVictories] = useState<Victory[]>([]);
  
  const [matchHistory, setMatchHistory] = useState<MatchHistoryItem[]>([]);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [selectedCharStats, setSelectedCharStats] = useState({ matches: 0, wins: 0, winRate: 0, missions: 0 });
  const [loadingStats, setLoadingStats] = useState(false);

  const [userEmail, setUserEmail] = useState('');
  const [username, setUsername] = useState(''); 
  const [userId, setUserId] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // --- MULTIPLAYER ---
  const [lobbyModalVisible, setLobbyModalVisible] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [joinCode, setJoinCode] = useState(''); 
  const roomChannelRef = useRef<RealtimeChannel | null>(null);

  // --- MODAIS ---
  const [createCharModalVisible, setCreateCharModalVisible] = useState(false);
  const [manageEventsModalVisible, setManageEventsModalVisible] = useState(false);
  const [createEventModalVisible, setCreateEventModalVisible] = useState(false);
  const [manageEffectsModalVisible, setManageEffectsModalVisible] = useState(false);
  const [createEffectModalVisible, setCreateEffectModalVisible] = useState(false);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<UserRosterItem | null>(null);

  // MODAL PARA SKILLS DE MEMBRO DE EQUIPE
  const [memberSkillsModalVisible, setMemberSkillsModalVisible] = useState(false);
  const [currentMemberIndex, setCurrentMemberIndex] = useState<number | null>(null);

  // --- FORMULÁRIO PERSONAGEM ---
  const [editingCharId, setEditingCharId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newOrigin, setNewOrigin] = useState('');
  const [newClass, setNewClass] = useState('');
  const [newCategory, setNewCategory] = useState<'individual' | 'equipe' | 'hit'>('individual');
  const [hpInput1, setHpInput1] = useState('10'); 
  
  const [hasShield, setHasShield] = useState(false);
  const [shieldInput, setShieldInput] = useState('0');

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [memberName, setMemberName] = useState('');
  const [memberHp, setMemberHp] = useState('');
  
  const [newImage, setNewImage] = useState(''); 
  const [pickedImageUri, setPickedImageUri] = useState(''); 
  const [newBanner, setNewBanner] = useState('');
  const [pickedBannerUri, setPickedBannerUri] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  
  // STATES PARA SKILLS
  const [tempSkills, setTempSkills] = useState<Partial<CharacterSkill>[]>([]);
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillCost, setSkillCost] = useState('');
  const [skillDuration, setSkillDuration] = useState(''); 
  const [skillType, setSkillType] = useState<'active' | 'passive' | 'transformation'>('active');
  const [skillGeneratesShield, setSkillGeneratesShield] = useState(false);
  const [skillShieldValue, setSkillShieldValue] = useState('');
  
  // CONTROLADOR DE EDIÇÃO
  const [editingSkillIndex, setEditingSkillIndex] = useState<number | null>(null);

  // --- FORMULÁRIO EVENTO/EFEITO ---
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventImage, setNewEventImage] = useState('');
  const [editingEffectId, setEditingEffectId] = useState<string | null>(null);
  const [effectTitle, setEffectTitle] = useState('');
  const [effectDesc, setEffectDesc] = useState('');
  const [effectType, setEffectType] = useState<'buff' | 'debuff'>('buff');
  const [effectDamage, setEffectDamage] = useState('');
  const [effectDuration, setEffectDuration] = useState('');

  const [saving, setSaving] = useState(false);

  // --- DATA FETCHING ---
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) { 
          setUserEmail(user.email || ''); 
          setUserId(user.id);
          const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single();
          setUsername(profile?.username || user.email?.split('@')[0] || 'Viajante');

          const { data: roster, error } = await supabase
            .from('user_roster')
            .select(`
                id, current_level, acquired_at, challenge_completed, 
                game_characters (*)
            `)
            .eq('user_id', user.id) 
            .order('acquired_at', { ascending: false });

          if (error) console.log("Erro roster:", error.message);
          else setPlayedCharacters(roster as any || []);
      }
      const { data: vict } = await supabase.from('victories').select('*');
      setVictories(vict || []);
      await fetchCatalogs();
    } catch (error: any) { console.log(error); } 
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const fetchCatalogs = async () => {
    const { data: chars } = await supabase.from('game_characters').select('*').order('name');
    if (chars) setCatalogChars(chars);
    const { data: events } = await supabase.from('game_events').select('*').order('title');
    if (events) setCatalogEvents(events);
    const { data: effects } = await supabase.from('game_status_effects').select('*').order('title');
    if (effects) setCatalogEffects(effects);
  };

  const fetchHistory = async () => {
      setLoading(true);
      const { data } = await supabase.from('match_history').select('*').order('played_at', { ascending: false }).limit(10);
      if (data) setMatchHistory(data);
      setLoading(false);
      setHistoryModalVisible(true);
  };

  // --- ACTIONS ---
  const handleToggleChallenge = async (item: UserRosterItem) => {
      const newValue = !item.challenge_completed;
      setPlayedCharacters(prev => prev.map(p => p.id === item.id ? { ...p, challenge_completed: newValue } : p));
      if (selectedCharacter && selectedCharacter.id === item.id) {
          setSelectedCharacter({ ...selectedCharacter, challenge_completed: newValue });
      }
      await supabase.from('user_roster').update({ challenge_completed: newValue }).eq('id', item.id);
  };

  const handleOpenDetails = async (item: UserRosterItem) => {
      if (!item.game_characters) return;
      setSelectedCharacter(item);
      setLoadingStats(true);
      setDetailsModalVisible(true);
      const { count: winsCount } = await supabase.from('victories').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('character_name', item.game_characters.name);
      const charWins = winsCount || 0;
      const { data: allHistory } = await supabase.from('match_history').select('participants_snapshot');
      let charMatches = 0;
      if (allHistory) {
          allHistory.forEach(match => {
              const played = match.participants_snapshot.some((p: any) => p.user_id === userId && p.selected_character_id === item.game_characters?.id);
              if (played) charMatches++;
          });
      }
      if (charMatches < charWins) charMatches = charWins;
      const rate = charMatches > 0 ? Math.round((charWins / charMatches) * 100) : 0;
      setSelectedCharStats({ wins: charWins, matches: charMatches, winRate: rate, missions: 0 });
      setLoadingStats(false);
  };

  useEffect(() => { fetchData(); }, []);

  // --- IMAGES ---
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 });
    if (!result.canceled) setPickedImageUri(result.assets[0].uri);
  };
  const pickBanner = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [16, 9], quality: 0.5 });
    if (!result.canceled) setPickedBannerUri(result.assets[0].uri);
  };
  const uploadToSupabase = async (uri: string): Promise<string | null> => {
    try {
        setUploadingImage(true);
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const arrayBuffer = decode(base64);
        const fileExt = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${fileName}`;
        const { error: uploadError } = await supabase.storage.from('rpg-images').upload(filePath, arrayBuffer, { contentType: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`, upsert: false });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('rpg-images').getPublicUrl(filePath);
        return data.publicUrl;
    } catch (error: any) {
        Alert.alert("Erro no upload", error.message || "Erro desconhecido");
        return null;
    } finally { setUploadingImage(false); }
  };

  // --- MULTIPLAYER ROOMS ---
  const subscribeToRoom = (roomCode: string) => {
    if (roomChannelRef.current) supabase.removeChannel(roomChannelRef.current);
    const channel = supabase.channel(`room_${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` }, (payload) => {
          const updatedRoom = payload.new as Room;
          setCurrentRoom(updatedRoom);
          if (updatedRoom.status === 'playing') { setLobbyModalVisible(false); onStartGame(roomCode); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_code=eq.${roomCode}` }, () => fetchParticipants(roomCode))
      .subscribe();
    roomChannelRef.current = channel;
  };

  const fetchParticipants = async (code: string) => {
    const { data } = await supabase.from('room_participants').select('*').eq('room_code', code);
    if (data) setParticipants(data);
  };

  const handleCreateRoom = async () => {
    const code = generateRoomCode();
    const { data, error } = await supabase.from('rooms').insert({ code, host_id: userId, status: 'waiting' }).select().single();
    if (error || !data) return Alert.alert('Erro', 'Não foi possível criar a sala. Verifique a conexão.');
    await supabase.from('room_participants').insert({ room_code: code, user_id: userId, user_email: userEmail, username });
    setCurrentRoom(data);
    setParticipants([{ id: 'local', room_code: code, user_id: userId, user_email: userEmail, username, is_ready: false, current_hp: 10, max_hp: 10 }]);
    subscribeToRoom(code);
    setLobbyModalVisible(true);
  };

  const handleJoinRoom = async () => {
    const code = joinCode.toUpperCase();
    if (code.length !== 4) return Alert.alert('Erro', 'Código inválido');
    const { data: room, error } = await supabase.from('rooms').select('*').eq('code', code).single();
    if (error || !room) return Alert.alert('Erro', 'Sala não encontrada');
    const { error: joinError } = await supabase.from('room_participants').insert({ room_code: code, user_id: userId, user_email: userEmail, username });
    if (joinError && joinError.code !== '23505') return Alert.alert('Erro ao entrar', joinError.message);
    setCurrentRoom(room);
    fetchParticipants(code);
    subscribeToRoom(code);
    setLobbyModalVisible(true);
  };

  const handleStartSelection = async () => {
    if (!currentRoom) return;
    await supabase.from('rooms').update({ status: 'selecting' }).eq('code', currentRoom.code);
  };

  const handleSelectCharacter = async (charId: string) => {
    if (!currentRoom) return;
    await supabase.from('room_participants').update({ selected_character_id: charId, is_ready: true }).eq('room_code', currentRoom.code).eq('user_id', userId);
    const existing = playedCharacters.find(p => p.game_characters && p.game_characters.id === charId);
    if (!existing) {
        await supabase.from('user_roster').insert({ user_id: userId, character_id: charId, current_level: 1 });
        fetchData(); 
    }
  };

  const handleStartGame = async () => {
    if (!currentRoom) return;
    let availableEvents = catalogEvents;
    if (availableEvents.length === 0) {
        const { data } = await supabase.from('game_events').select('*');
        if (data && data.length > 0) { availableEvents = data; setCatalogEvents(data); } 
        else { return Alert.alert('Erro', 'Crie um evento antes de iniciar.'); }
    }
    const everyoneReady = participants.every(p => p.is_ready);
    if (!everyoneReady) return Alert.alert('Aguarde', 'Jogadores escolhendo...');

    setSaving(true);
    try {
        const randomEvent = availableEvents[Math.floor(Math.random() * availableEvents.length)];
        const shuffled = [...participants].sort(() => Math.random() - 0.5);
        
        for (let i = 0; i < shuffled.length; i++) {
            const selectedCharId = shuffled[i].selected_character_id;
            const charData = catalogChars.find(c => c.id === selectedCharId);
            let initialHp = 10;
            let initialShield = charData?.base_shield || 0;
            let initialTeamState: any[] = [];
            if (charData?.category === 'equipe') { initialHp = 0; initialTeamState = []; } 
            else { initialHp = charData?.base_hp || 10; }
            await supabase.from('room_participants').update({ turn_order: i + 1, current_hp: initialHp, max_hp: initialHp, current_shield: initialShield, buffs: '', debuffs: '', active_transformations: [], team_state: initialTeamState, active_member_name: null }).eq('id', shuffled[i].id);
        }
        await supabase.from('rooms').update({ status: 'playing', selected_event_id: randomEvent.id, current_turn_participant_id: shuffled[0].id }).eq('code', currentRoom.code);
    } catch (error: any) { Alert.alert('Erro', error.message); } finally { setSaving(false); }
  };

  const handleLeaveRoom = async () => {
    if (currentRoom) {
        if (roomChannelRef.current) supabase.removeChannel(roomChannelRef.current);
        await supabase.from('room_participants').delete().eq('room_code', currentRoom.code).eq('user_id', userId);
    }
    setLobbyModalVisible(false); setCurrentRoom(null); setParticipants([]);
  };

  // --- CRUD CHAR ---

  const clearSkillForm = () => {
      setSkillName(''); setSkillDesc(''); setSkillCost(''); setSkillDuration(''); setSkillShieldValue(''); 
      setSkillGeneratesShield(false); setSkillType('active'); 
      setEditingSkillIndex(null); 
  };

  const handleEditSkill = (index: number) => {
    const skill = tempSkills[index];
    if (!skill) return;
    setSkillName(skill.name || ''); setSkillDesc(skill.description || ''); setSkillCost(skill.cost || ''); setSkillDuration(skill.duration ? String(skill.duration) : ''); setSkillType(skill.type || 'active');
    if (skill.shield_value && skill.shield_value > 0) { setSkillGeneratesShield(true); setSkillShieldValue(String(skill.shield_value)); } else { setSkillGeneratesShield(false); setSkillShieldValue(''); }
    setEditingSkillIndex(index);
  };

  const openCreateCharModal = () => {
    setEditingCharId(null);
    setNewName(''); setNewOrigin(''); setNewClass(''); setNewImage(''); 
    setHpInput1('10'); setNewCategory('individual'); setTeamMembers([]); setMemberName(''); setMemberHp('');
    setHasShield(false); setShieldInput('0'); setPickedImageUri(''); 
    setTempSkills([]); clearSkillForm(); 
    setNewBanner(''); setPickedBannerUri('');
    setCreateCharModalVisible(true);
  };

  const openEditCharModal = async (char: GameCharacterWithCreator) => {
    setEditingCharId(char.id);
    setNewName(char.name); setNewOrigin(char.anime_origin); setNewClass(char.base_class); setNewImage(char.image_url || ''); setPickedImageUri(''); 
    setNewCategory(char.category || 'individual');
    
    // Carrega membros da equipe se existirem
    if (char.category === 'equipe') { setTeamMembers(char.team_members || []); setHpInput1('0'); } 
    else { setHpInput1(String(char.base_hp)); }
    
    setHasShield((char.base_shield || 0) > 0);
    setShieldInput(String(char.base_shield || 0));
    setNewBanner(char.challenge_banner_url || ''); setPickedBannerUri('');
    
    // Carrega skills INDIVIDUAIS
    const { data: skills } = await supabase.from('character_skills').select('*').eq('character_id', char.id);
    if(skills) { setTempSkills(skills.map(s => ({ id: s.id, name: s.name, description: s.description, type: s.type as any, cost: s.cost || '', duration: s.duration || 0, shield_value: s.shield_value || 0 }))); } else { setTempSkills([]); }
    
    clearSkillForm(); 
    setCreateCharModalVisible(true);
  };

  const addMemberToTeam = () => { const hp = parseInt(memberHp); if (!memberName || isNaN(hp)) { Alert.alert("Ops", "Preencha nome e vida válida."); return; } setTeamMembers([...teamMembers, { name: memberName, base_hp: hp, skills: [] }]); setMemberName(''); setMemberHp(''); };
  const removeMemberFromTeam = (index: number) => { const updated = [...teamMembers]; updated.splice(index, 1); setTeamMembers(updated); };

  const openMemberSkills = (index: number) => {
      setCurrentMemberIndex(index);
      const member = teamMembers[index];
      // Carrega skills do membro para o estado temporário
      setTempSkills(member.skills || []); 
      clearSkillForm(); 
      setMemberSkillsModalVisible(true);
  };

  const closeMemberSkills = () => {
      if (currentMemberIndex !== null) {
          const updatedMembers = [...teamMembers];
          // Salva as skills de volta no array de membros
          updatedMembers[currentMemberIndex].skills = tempSkills as CharacterSkill[];
          setTeamMembers(updatedMembers);
      }
      setTempSkills([]); setCurrentMemberIndex(null); clearSkillForm(); 
      setMemberSkillsModalVisible(false);
  };

  const addSkillToTempList = () => { 
      if (!skillName) return Alert.alert("Ops", "Dê um nome para a habilidade"); 
      
      const newSkillData: Partial<CharacterSkill> = { 
          id: editingSkillIndex !== null ? tempSkills[editingSkillIndex].id : Math.random().toString(), 
          name: skillName, 
          description: skillDesc, 
          cost: skillCost, 
          type: skillType, 
          duration: parseInt(skillDuration) || 0, 
          shield_value: skillGeneratesShield ? (parseInt(skillShieldValue) || 0) : 0 
      }; 

      if (editingSkillIndex !== null) {
          const updatedSkills = [...tempSkills];
          updatedSkills[editingSkillIndex] = newSkillData;
          setTempSkills(updatedSkills);
          Alert.alert("Sucesso", "Habilidade atualizada!");
      } else {
          setTempSkills([...tempSkills, newSkillData]); 
      }
      clearSkillForm();
  };
  
  const removeSkillFromTemp = (index: number) => { const updated = [...tempSkills]; updated.splice(index, 1); setTempSkills(updated); };

  const handleDeleteChar = async (id: string) => { Alert.alert("Excluir", "Tem certeza?", [ { text: "Cancelar" }, { text: "Excluir", onPress: async () => { await supabase.from('game_characters').delete().eq('id', id); fetchCatalogs(); }}]); };
  
  const handleSaveChar = async () => {
    if(!newName || !newOrigin || !newClass) return Alert.alert("Erro", "Preencha os dados básicos");
    setSaving(true);
    try {
        let finalImageUrl = newImage; 
        if (pickedImageUri) { const uploadedUrl = await uploadToSupabase(pickedImageUri); if (uploadedUrl) finalImageUrl = uploadedUrl; else throw new Error("Falha no upload da imagem"); }
        let finalBannerUrl = newBanner;
        if (pickedBannerUri) { const uploadedBannerUrl = await uploadToSupabase(pickedBannerUri); if (uploadedBannerUrl) finalBannerUrl = uploadedBannerUrl; else throw new Error("Falha no upload do banner"); }

        let finalHp = 10; let finalUnitCount = 1;
        if (newCategory === 'equipe') { finalHp = 0; finalUnitCount = teamMembers.length; if (teamMembers.length === 0) return Alert.alert("Erro", "Adicione membros."); } else if (newCategory === 'hit') { finalHp = parseInt(hpInput1) || 1; } else { finalHp = parseInt(hpInput1) || 10; }
        
        // Aqui salvamos o teamMembers COMPLETO (com as skills atualizadas) no JSON
        const charPayload = { 
            name: newName, 
            anime_origin: newOrigin, 
            base_class: newClass, 
            image_url: finalImageUrl || null, 
            challenge_banner_url: finalBannerUrl || null, 
            base_hp: finalHp, 
            category: newCategory, 
            unit_count: finalUnitCount, 
            team_members: newCategory === 'equipe' ? teamMembers : null, 
            base_shield: hasShield ? (parseInt(shieldInput) || 0) : 0 
        };

        let charId = editingCharId;
        if(editingCharId) { 
            await supabase.from('game_characters').update(charPayload).eq('id', editingCharId); 
            // Limpa tabela relacional para evitar duplicidade ou dados órfãos
            await supabase.from('character_skills').delete().eq('character_id', editingCharId);
        } else { 
            const { data, error } = await supabase.from('game_characters').insert(charPayload).select().single(); 
            if (error) throw error; 
            charId = data.id; 
        }

        // Salva skills INDIVIDUAIS no BD relacional (se não for equipe)
        if (charId && newCategory !== 'equipe' && tempSkills.length > 0) { 
            const skillsToInsert = tempSkills.map(s => ({ character_id: charId, name: s.name, description: s.description, type: s.type, cost: s.cost, duration: s.duration, shield_value: s.shield_value })); 
            const { error: skillError } = await supabase.from('character_skills').insert(skillsToInsert); 
            if (skillError) throw skillError; 
        }

        Alert.alert("Sucesso", "Personagem salvo!"); setCreateCharModalVisible(false); fetchCatalogs(); if(currentRoom) setLobbyModalVisible(true);
    } catch (e: any) { Alert.alert("Erro ao salvar", e.message); } finally { setSaving(false); setUploadingImage(false); }
  };

  // ... CRUD Eventos/Efeitos ...
  const openCreateEventModal = () => { setEditingEventId(null); setNewEventTitle(''); setNewEventDesc(''); setNewEventImage(''); setCreateEventModalVisible(true); };
  const openEditEventModal = (ev: GameEvent) => { setEditingEventId(ev.id); setNewEventTitle(ev.title); setNewEventDesc(ev.description); setNewEventImage(ev.image_url||''); setCreateEventModalVisible(true); }
  const handleSaveEvent = async () => { if(!newEventTitle) return; const p = {title:newEventTitle, description:newEventDesc, image_url:newEventImage||null}; if(editingEventId) await supabase.from('game_events').update(p).eq('id',editingEventId); else await supabase.from('game_events').insert(p); setCreateEventModalVisible(false); fetchCatalogs(); };
  const deleteEvent = async(id:string) => { await supabase.from('game_events').delete().eq('id',id); fetchCatalogs(); }
  const openCreateEffectModal = () => { setEditingEffectId(null); setEffectTitle(''); setEffectDesc(''); setEffectDamage(''); setEffectDuration(''); setEffectType('buff'); setCreateEffectModalVisible(true); };
  const openEditEffectModal = (eff: StatusEffect) => { setEditingEffectId(eff.id); setEffectTitle(eff.title); setEffectDesc(eff.description); setEffectType(eff.type); setEffectDamage(eff.damage || ''); setEffectDuration(String(eff.duration || '')); setCreateEffectModalVisible(true); };
  const handleSaveEffect = async () => { if(!effectTitle) return Alert.alert("Erro", "Título é obrigatório"); const p = { title: effectTitle, description: effectDesc, type: effectType, damage: effectType === 'debuff' ? effectDamage : null, duration: parseInt(effectDuration) || 0 }; if(editingEffectId) await supabase.from('game_status_effects').update(p).eq('id', editingEffectId); else await supabase.from('game_status_effects').insert(p); setCreateEffectModalVisible(false); fetchCatalogs(); };
  const deleteEffect = async(id:string) => { await supabase.from('game_status_effects').delete().eq('id',id); fetchCatalogs(); };
  
  const getCategoryColor = (cat?: string) => { switch(cat) { case 'equipe': return '#FFD700'; case 'hit': return '#ff4444'; default: return '#00B37E'; } };
  const formatDuration = (seconds: number) => { const mins = Math.floor(seconds / 60); const secs = seconds % 60; return `${mins}m ${secs}s`; };

  const renderPlayedChar = (item: UserRosterItem) => {
    if (!item.game_characters) return null;
    return ( 
        <TouchableOpacity key={item.id} style={styles.card} onPress={() => handleOpenDetails(item)}> 
            {item.game_characters?.image_url ? 
                <Image source={{ uri: item.game_characters.image_url }} style={styles.charImage} /> 
                : <View style={[styles.charIcon, { backgroundColor: '#3e2e6b' }]}><Text style={{fontSize: 20}}>⚔️</Text></View>
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
      <View style={styles.header}>
          <View>
              <Text style={styles.greeting}>Olá, {username}</Text>
              <Text style={styles.userEmail}>{userEmail}</Text>
          </View>
          <View style={{flexDirection:'row'}}>
              <TouchableOpacity onPress={fetchHistory} style={[styles.logoutButton, {marginRight:10, backgroundColor:'#8257e5'}]}>
                  <Ionicons name="time" size={24} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={async () => await supabase.auth.signOut()} style={styles.logoutButton}>
                  <Ionicons name="log-out-outline" size={24} color="#ff4444" />
              </TouchableOpacity>
          </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor="#8257e5"/>}>
        <View style={styles.matchmakingContainer}>
            <Text style={styles.sectionTitle}>Multiplayer</Text>
            <TouchableOpacity style={styles.newGameButton} onPress={() => { handleCreateRoom(); fetchCatalogs(); }}>
                <View style={styles.newGameIcon}><Ionicons name="add" size={32} color="#fff" /></View>
                <View><Text style={styles.newGameTitle}>CRIAR SALA</Text><Text style={styles.newGameSubtitle}>Seja o Host da partida</Text></View>
            </TouchableOpacity>
            <View style={styles.joinContainer}>
                <TextInput style={styles.joinInput} placeholder="CÓDIGO" placeholderTextColor="#555" maxLength={4} autoCapitalize="characters" value={joinCode} onChangeText={setJoinCode}/>
                <TouchableOpacity style={styles.joinButton} onPress={() => { handleJoinRoom(); fetchCatalogs(); }}>
                    <Text style={styles.joinButtonText}>ENTRAR</Text>
                </TouchableOpacity>
            </View>
        </View>

        <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.createButton, {flex: 1, marginRight: 5}]} onPress={openCreateCharModal}>
                <Ionicons name="person-add" size={18} color="#8257e5" style={{marginRight: 5}}/>
                <Text style={styles.createButtonText}>Add Char</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.createButton, {flex: 1, marginHorizontal: 5, borderColor: '#00B37E'}]} onPress={() => { setManageEventsModalVisible(true); fetchCatalogs(); }}>
                <Ionicons name="library" size={18} color="#00B37E" style={{marginRight: 5}}/>
                <Text style={[styles.createButtonText, {color: '#00B37E'}]}>Eventos</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.createButton, {flex: 1, marginLeft: 5, borderColor: '#FFD700'}]} onPress={() => { setManageEffectsModalVisible(true); fetchCatalogs(); }}>
                <Ionicons name="flask" size={18} color="#FFD700" style={{marginRight: 5}}/>
                <Text style={[styles.createButtonText, {color: '#FFD700'}]}>Efeitos</Text>
            </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Seu Histórico</Text>
        {playedCharacters.length === 0 ? <Text style={styles.emptyText}>Sem histórico.</Text> : playedCharacters.map(item => renderPlayedChar(item))}
      </ScrollView>

      {/* LOBBY */}
      <Modal animationType="slide" transparent={false} visible={lobbyModalVisible} onRequestClose={()=>{}}>
          <View style={styles.lobbyContainer}>
              <View style={styles.lobbyHeader}>
                  <Text style={styles.lobbyTitle}>Sala: {currentRoom?.code}</Text>
                  <TouchableOpacity onPress={handleLeaveRoom}><Ionicons name="close-circle" size={32} color="#ff4444" /></TouchableOpacity>
              </View>
              {currentRoom?.status === 'waiting' && (
                  <View style={{flex: 1, justifyContent:'center', alignItems:'center'}}>
                      <Text style={styles.phaseTitle}>Aguardando...</Text>
                      <View style={styles.participantsList}>
                          {participants.map(p => (
                              <View key={p.id} style={styles.participantRow}>
                                  <Ionicons name="person" size={20} color="#fff" />
                                  <Text style={styles.participantName}>{p.username}</Text>
                                  {p.user_id === currentRoom.host_id && <Text style={{color:'#FFD700', marginLeft:5}}>👑</Text>}
                              </View>
                          ))}
                      </View>
                      {userId === currentRoom.host_id ? (
                          <TouchableOpacity style={styles.actionButton} onPress={handleStartSelection}>
                              <Text style={styles.actionButtonText}>INICIAR SELEÇÃO</Text>
                          </TouchableOpacity>
                      ) : (
                          <Text style={{color:'#777'}}>Aguardando Host...</Text>
                      )}
                  </View>
              )}
              {currentRoom?.status === 'selecting' && (
                  <View style={{flex: 1}}>
                      <Text style={styles.phaseTitle}>Escolha seu Herói</Text>
                      <Text style={{color:'#ccc', textAlign:'center', marginBottom:10}}>{participants.filter(p => p.is_ready).length} / {participants.length} prontos</Text>
                      {participants.find(p => p.user_id === userId)?.is_ready ? (
                          <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
                              <Ionicons name="checkmark-circle" size={64} color="#00B37E" />
                              <Text style={{color:'#fff', marginTop:10}}>Selecionado!</Text>
                              {userId === currentRoom.host_id && participants.every(p => p.is_ready) && (
                                  <TouchableOpacity style={[styles.actionButton, {marginTop:30, backgroundColor:'#FFD700'}]} onPress={handleStartGame} disabled={saving}>
                                      <Text style={[styles.actionButtonText, {color:'#000'}]}>INICIAR PARTIDA</Text>
                                  </TouchableOpacity>
                              )}
                          </View>
                      ) : (
                          <FlatList data={catalogChars} keyExtractor={item => item.id} renderItem={({item}) => (
                              <View style={styles.catalogItem}>
                                  <TouchableOpacity style={{flex: 1, flexDirection:'row', alignItems:'center'}} onPress={() => handleSelectCharacter(item.id)}>
                                      {item.image_url && <Image source={{uri: item.image_url}} style={styles.catalogImage} />}
                                      <View style={styles.catalogInfo}>
                                          <Text style={styles.catalogName}>{item.name} (HP: {item.base_hp})</Text>
                                          <View style={{flexDirection:'row'}}>
                                              <Text style={styles.catalogOrigin}>{item.base_class}</Text>
                                              <Text style={[styles.catalogOrigin, {marginLeft: 10, color: getCategoryColor(item.category), fontWeight:'bold'}]}>• {item.category?.toUpperCase() || 'INDIVIDUAL'}</Text>
                                          </View>
                                      </View>
                                      <Ionicons name="arrow-forward-circle" size={32} color="#8257e5" />
                                  </TouchableOpacity>
                                  <View style={{flexDirection:'row', marginLeft: 10}}>
                                      <TouchableOpacity onPress={() => openEditCharModal(item)} style={{padding:5}}><Ionicons name="pencil" size={20} color="#8257e5" /></TouchableOpacity>
                                      <TouchableOpacity onPress={() => handleDeleteChar(item.id)} style={{padding:5}}><Ionicons name="trash" size={20} color="#ff4444" /></TouchableOpacity>
                                  </View>
                              </View>
                          )}/>
                      )}
                  </View>
              )}
          </View>
      </Modal>

      {/* HISTORY */}
      <Modal animationType="slide" transparent={true} visible={historyModalVisible} onRequestClose={() => setHistoryModalVisible(false)}>
        <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, {maxHeight: '80%'}]}>
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>📜 Últimas 10 Partidas</Text>
                    <TouchableOpacity onPress={() => setHistoryModalVisible(false)}><Ionicons name="close" size={24} color="#ccc" /></TouchableOpacity>
                </View>
                {matchHistory.length === 0 ? (
                    <Text style={{color:'#777', textAlign:'center', marginTop:20}}>Nenhuma partida encontrada.</Text>
                ) : (
                    <FlatList
                        data={matchHistory}
                        keyExtractor={item => item.id}
                        renderItem={({item}) => (
                            <View style={styles.historyCard}>
                                <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:5}}>
                                    <Text style={{color:'#FFD700', fontWeight:'bold', fontSize:16}}>🏆 {item.winner_name}</Text>
                                    <Text style={{color:'#aaa', fontSize:12}}>{new Date(item.played_at).toLocaleDateString()}</Text>
                                </View>
                                <Text style={{color:'#fff', marginBottom:5}}>Venceu com: <Text style={{fontWeight:'bold', color:'#8257e5'}}>{item.winner_character}</Text></Text>
                                <Text style={{color:'#ccc', fontSize:12, marginBottom:10}}>⏱️ Duração: {formatDuration(item.duration_seconds)}</Text>
                                <View style={{backgroundColor:'#222', padding:8, borderRadius:4}}>
                                    <Text style={{color:'#777', fontSize:10, marginBottom:3}}>RESULTADOS:</Text>
                                    {item.participants_snapshot?.map((p, idx) => (
                                        <Text key={idx} style={{color: p.username === item.winner_name ? '#FFD700' : '#888', fontSize:11}}>
                                            {idx + 1}. {p.username} {p.current_hp <= 0 && '(💀)'}
                                        </Text>
                                    ))}
                                </View>
                            </View>
                        )}
                    />
                )}
            </View>
        </View>
      </Modal>
      
      {/* CREATE CHAR MODAL */}
      <Modal transparent visible={createCharModalVisible} animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, {maxHeight: '90%'}]}>
            <ScrollView>
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
                
                {/* SEÇÃO EQUIPE */}
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

                <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                    <Text style={{color:'#fff', fontWeight:'bold'}}>Possui Escudo Inicial?</Text>
                    <TouchableOpacity onPress={() => setHasShield(!hasShield)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: hasShield ? '#00B37E' : 'transparent'}}>
                        {hasShield && <Ionicons name="checkmark" size={18} color="#fff" />}
                    </TouchableOpacity>
                </View>
                {hasShield && (
                    <TextInput style={styles.input} placeholder="Quantidade de Escudo" placeholderTextColor="#555" value={shieldInput} onChangeText={setShieldInput} keyboardType="numeric"/>
                )}

                <Text style={[styles.sectionHeader, {marginTop:10}]}>IMAGEM DO PERSONAGEM</Text>
                <TouchableOpacity onPress={pickImage} style={styles.imagePickerBtn}>
                    {pickedImageUri ? <Image source={{ uri: pickedImageUri }} style={styles.imagePreview} /> : newImage ? <Image source={{ uri: newImage }} style={styles.imagePreview} /> : <View style={{alignItems:'center'}}><Ionicons name="image-outline" size={40} color="#777" /><Text style={{color:'#777', marginTop:5}}>Toque para selecionar</Text></View>}
                </TouchableOpacity>

                <Text style={[styles.sectionHeader, {marginTop:20}]}>BANNER DE DESAFIO (Para Mestres)</Text>
                <TouchableOpacity onPress={pickBanner} style={[styles.imagePickerBtn, {height: 100}]}>
                    {pickedBannerUri ? <Image source={{ uri: pickedBannerUri }} style={styles.imagePreview} /> : newBanner ? <Image source={{ uri: newBanner }} style={styles.imagePreview} /> : <View style={{alignItems:'center'}}><Ionicons name="flag-outline" size={30} color="#777" /><Text style={{color:'#777', marginTop:5}}>Selecionar Banner</Text></View>}
                </TouchableOpacity>

                {/* SKILLS INDIVIDUAIS */}
                {newCategory !== 'equipe' && (
                    <>
                        <Text style={[styles.sectionHeader, {marginTop:20}]}>{editingSkillIndex !== null ? `EDITANDO: ${tempSkills[editingSkillIndex].name}` : "ADICIONAR HABILIDADE / TRANSFORMAÇÃO"}</Text>
                        
                        {/* FORMULÁRIO DE SKILL COM DESTAQUE NA EDIÇÃO */}
                        <View style={[styles.skillForm, editingSkillIndex !== null && {borderWidth:1, borderColor:'#FFD700', backgroundColor:'#2a2a20'}]}>
                            <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Nome Skill" placeholderTextColor="#555" value={skillName} onChangeText={setSkillName}/>
                            <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Descrição" placeholderTextColor="#555" value={skillDesc} onChangeText={setSkillDesc}/>
                            {skillType !== 'passive' && (<View><TextInput style={[styles.input, {marginBottom:10}]} placeholder="Custo" placeholderTextColor="#555" value={skillCost} onChangeText={setSkillCost}/><TextInput style={[styles.input, {marginBottom:10}]} placeholder="Duração" placeholderTextColor="#555" value={skillDuration} onChangeText={setSkillDuration} keyboardType="numeric"/></View>)}
                            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}><Text style={{color:'#aaa', fontSize:12}}>Gera Escudo?</Text><TouchableOpacity onPress={() => setSkillGeneratesShield(!skillGeneratesShield)} style={{width:20, height:20, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: skillGeneratesShield ? '#FFD700' : 'transparent'}}>{skillGeneratesShield && <Ionicons name="checkmark" size={14} color="#000" />}</TouchableOpacity></View>
                            {skillGeneratesShield && (<TextInput style={[styles.input, {marginBottom:10}]} placeholder="Valor do Escudo" placeholderTextColor="#555" value={skillShieldValue} onChangeText={setSkillShieldValue} keyboardType="numeric"/>)}
                            <View style={{flexDirection:'row', justifyContent:'space-around', marginBottom:15}}><TouchableOpacity onPress={()=>setSkillType('active')} style={[styles.typeBadge, skillType==='active' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>Ativa</Text></TouchableOpacity><TouchableOpacity onPress={()=>setSkillType('passive')} style={[styles.typeBadge, skillType==='passive' && {backgroundColor:'#8257e5', borderColor:'#8257e5'}]}><Text style={styles.typeText}>Passiva</Text></TouchableOpacity><TouchableOpacity onPress={()=>setSkillType('transformation')} style={[styles.typeBadge, skillType==='transformation' && {backgroundColor:'#FFD700', borderColor:'#FFD700'}]}><Text style={[styles.typeText, skillType==='transformation' && {color:'black'}]}>Transform</Text></TouchableOpacity></View>
                            
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

                        {/* LISTA DE SKILLS COM ÍCONE DE EDIÇÃO */}
                        {tempSkills.length > 0 && (
                            <View style={{marginTop:15}}>
                                <Text style={{color:'#ccc', marginBottom:5}}>Lista de Habilidades ({tempSkills.length}):</Text>
                                {tempSkills.map((s, index) => (
                                    <View key={index} style={styles.skillRow}>
                                        <View style={{flex:1}}>
                                            <Text style={{color:'#fff', fontWeight:'bold'}}>{s.name}</Text>
                                            <Text style={{color:'#777', fontSize:10}}>{s.description} {s.shield_value ? ` • Escudo: ${s.shield_value}` : ''}</Text>
                                        </View>
                                        <View style={{flexDirection:'row'}}>
                                            <TouchableOpacity onPress={() => handleEditSkill(index)} style={{marginRight: 15}}>
                                                <Ionicons name="pencil" size={18} color="#FFD700" />
                                            </TouchableOpacity>
                                            <TouchableOpacity onPress={() => removeSkillFromTemp(index)}>
                                                <Ionicons name="trash" size={18} color="#ff4444" />
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}
                    </>
                )}
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
                        <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Nome Skill" placeholderTextColor="#555" value={skillName} onChangeText={setSkillName}/>
                        <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Descrição" placeholderTextColor="#555" value={skillDesc} onChangeText={setSkillDesc}/>
                        {skillType !== 'passive' && (<View><TextInput style={[styles.input, {marginBottom:10}]} placeholder="Custo" placeholderTextColor="#555" value={skillCost} onChangeText={setSkillCost}/><TextInput style={[styles.input, {marginBottom:10}]} placeholder="Duração" placeholderTextColor="#555" value={skillDuration} onChangeText={setSkillDuration} keyboardType="numeric"/></View>)}
                        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}><Text style={{color:'#aaa', fontSize:12}}>Gera Escudo?</Text><TouchableOpacity onPress={() => setSkillGeneratesShield(!skillGeneratesShield)} style={{width:20, height:20, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: skillGeneratesShield ? '#FFD700' : 'transparent'}}>{skillGeneratesShield && <Ionicons name="checkmark" size={14} color="#000" />}</TouchableOpacity></View>
                        {skillGeneratesShield && (<TextInput style={[styles.input, {marginBottom:10}]} placeholder="Valor do Escudo" placeholderTextColor="#555" value={skillShieldValue} onChangeText={setSkillShieldValue} keyboardType="numeric"/>)}
                        <View style={{flexDirection:'row', justifyContent:'space-around', marginBottom:15}}><TouchableOpacity onPress={()=>setSkillType('active')} style={[styles.typeBadge, skillType==='active' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>Ativa</Text></TouchableOpacity><TouchableOpacity onPress={()=>setSkillType('passive')} style={[styles.typeBadge, skillType==='passive' && {backgroundColor:'#8257e5', borderColor:'#8257e5'}]}><Text style={styles.typeText}>Passiva</Text></TouchableOpacity><TouchableOpacity onPress={()=>setSkillType('transformation')} style={[styles.typeBadge, skillType==='transformation' && {backgroundColor:'#FFD700', borderColor:'#FFD700'}]}><Text style={[styles.typeText, skillType==='transformation' && {color:'black'}]}>Transform</Text></TouchableOpacity></View>
                        
                        <View style={{flexDirection:'row', marginTop: 10}}>
                            <TouchableOpacity onPress={addSkillToTempList} style={[styles.saveButton, {flex: 1, marginTop:0, backgroundColor: editingSkillIndex !== null ? '#FFD700' : '#333', borderColor:'#555', borderWidth:1, marginRight: 5}]}>
                                <Text style={{color: editingSkillIndex !== null ? '#000' : '#fff', fontWeight:'bold'}}>
                                    {editingSkillIndex !== null ? "SALVAR ALTERAÇÃO" : "+ Adicionar Skill"}
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
                                    <View style={{flex:1}}><Text style={{color:'#fff', fontWeight:'bold'}}>{s.name}</Text><Text style={{color:'#777', fontSize:10}}>{s.description}</Text></View>
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

      {/* EVENT/EFFECT MODALS */}
      <Modal transparent visible={manageEventsModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Eventos</Text><TouchableOpacity onPress={openCreateEventModal}><Ionicons name="add-circle" size={28} color="#00B37E"/></TouchableOpacity><TouchableOpacity onPress={()=>setManageEventsModalVisible(false)}><Ionicons name="close" size={24} color="#ccc"/></TouchableOpacity></View><FlatList data={catalogEvents} keyExtractor={i=>i.id} renderItem={({item})=>(<View style={styles.catalogItem}><View style={{flex:1}}><Text style={styles.catalogName}>{item.title}</Text></View><TouchableOpacity onPress={()=>openEditEventModal(item)} style={{marginRight:15}}><Ionicons name="pencil" size={20} color="#8257e5"/></TouchableOpacity><TouchableOpacity onPress={()=>deleteEvent(item.id)}><Ionicons name="trash" size={20} color="red"/></TouchableOpacity></View>)}/></View></View></Modal>
      <Modal transparent visible={createEventModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>Criar Evento</Text><TextInput style={styles.input} placeholder="Título" placeholderTextColor="#555" value={newEventTitle} onChangeText={setNewEventTitle}/><TextInput style={styles.input} placeholder="Descrição" placeholderTextColor="#555" value={newEventDesc} onChangeText={setNewEventDesc}/><TextInput style={styles.input} placeholder="URL Imagem" placeholderTextColor="#555" value={newEventImage} onChangeText={setNewEventImage}/><TouchableOpacity onPress={handleSaveEvent} style={styles.saveButton}><Text style={styles.saveButtonText}>SALVAR</Text></TouchableOpacity><TouchableOpacity onPress={()=>setCreateEventModalVisible(false)} style={[styles.saveButton,{backgroundColor:'#333', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity></View></View></Modal>
      <Modal transparent visible={manageEffectsModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Buffs & Debuffs</Text><TouchableOpacity onPress={openCreateEffectModal}><Ionicons name="add-circle" size={28} color="#00B37E"/></TouchableOpacity><TouchableOpacity onPress={()=>setManageEffectsModalVisible(false)}><Ionicons name="close" size={24} color="#ccc"/></TouchableOpacity></View><FlatList data={catalogEffects} keyExtractor={i=>i.id} renderItem={({item})=>(<View style={styles.catalogItem}><View style={{flex:1}}><Text style={[styles.catalogName, {color: item.type==='buff'?'#00B37E':'#ff4444'}]}>{item.title}</Text><Text style={styles.catalogOrigin}>{item.type.toUpperCase()}{item.duration ? ` • ${item.duration} Rnds` : ''}</Text></View><TouchableOpacity onPress={()=>openEditEffectModal(item)} style={{marginRight:15}}><Ionicons name="pencil" size={20} color="#8257e5"/></TouchableOpacity><TouchableOpacity onPress={()=>deleteEffect(item.id)}><Ionicons name="trash" size={20} color="red"/></TouchableOpacity></View>)}/></View></View></Modal>
      <Modal transparent visible={createEffectModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>{editingEffectId ? "Editar Efeito" : "Criar Efeito"}</Text><View style={{flexDirection:'row', marginBottom:15}}><TouchableOpacity onPress={()=>setEffectType('buff')} style={[styles.typeBadge, effectType==='buff' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>BUFF (Bom)</Text></TouchableOpacity><TouchableOpacity onPress={()=>setEffectType('debuff')} style={[styles.typeBadge, effectType==='debuff' && {backgroundColor:'#ff4444', borderColor:'#ff4444'}]}><Text style={styles.typeText}>DEBUFF (Ruim)</Text></TouchableOpacity></View><TextInput style={styles.input} placeholder="Título (Ex: Veneno)" placeholderTextColor="#555" value={effectTitle} onChangeText={setEffectTitle}/><TextInput style={styles.input} placeholder="Descrição" placeholderTextColor="#555" value={effectDesc} onChangeText={setEffectDesc}/><TextInput style={styles.input} placeholder="Duração" placeholderTextColor="#555" value={effectDuration} onChangeText={setEffectDuration} keyboardType="numeric"/>{effectType === 'debuff' && (<TextInput style={[styles.input, {borderColor:'#ff4444'}]} placeholder="Dano (Ex: 10)" placeholderTextColor="#555" value={effectDamage} onChangeText={setEffectDamage}/>)}<TouchableOpacity onPress={handleSaveEffect} style={styles.saveButton}><Text style={styles.saveButtonText}>SALVAR</Text></TouchableOpacity><TouchableOpacity onPress={()=>setCreateEffectModalVisible(false)} style={[styles.saveButton,{backgroundColor:'#333', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity></View></View></Modal>
      
      {/* DETAILS MODAL */}
      <Modal animationType="fade" transparent={true} visible={detailsModalVisible} onRequestClose={() => setDetailsModalVisible(false)}>
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { height: '65%' }]}>
                  {selectedCharacter ? (
                      <View style={{alignItems: 'center'}}>
                          {selectedCharacter.game_characters?.image_url ? 
                              <Image source={{uri: selectedCharacter.game_characters.image_url}} style={styles.detailsImageBig} /> 
                              : <View style={styles.detailsIconBig}><Text style={{fontSize: 40}}>👤</Text></View>
                          }
                          
                          <Text style={styles.detailsTitle}>{selectedCharacter.game_characters?.name || 'Desconhecido'}</Text>
                          <Text style={styles.detailsClass}>{selectedCharacter.game_characters?.base_class}</Text>
                          <Text style={[styles.detailsClass, {color: getCategoryColor(selectedCharacter.game_characters?.category), marginTop:5}]}>{selectedCharacter.game_characters?.category?.toUpperCase() || 'INDIVIDUAL'}</Text>
                          
                          <View style={styles.levelBigBadge}>
                              <Text style={styles.levelLabel}>HP BASE: {selectedCharacter.game_characters?.base_hp}</Text>
                              {(selectedCharacter.game_characters?.base_shield || 0) > 0 && <Text style={[styles.levelLabel, {color:'#44aaff', marginTop:5}]}>ESCUDO: {selectedCharacter.game_characters?.base_shield}</Text>}
                          </View>

                          <View style={styles.statsRow}>
                              <View style={styles.statBox}>
                                  <Ionicons name="trophy" size={24} color="#FFD700" />
                                  <Text style={styles.statValue}>{selectedCharStats.wins}</Text>
                                  <Text style={styles.statLabel}>Vitórias (Lv)</Text>
                              </View>
                              <View style={styles.statBox}>
                                  <Ionicons name="game-controller" size={24} color="#ccc" />
                                  <Text style={styles.statValue}>{selectedCharStats.matches}</Text>
                                  <Text style={styles.statLabel}>Partidas</Text>
                              </View>
                              <View style={styles.statBox}>
                                  <Ionicons name="pie-chart" size={24} color="#8257e5" />
                                  <Text style={styles.statValue}>{selectedCharStats.winRate}%</Text>
                                  <Text style={styles.statLabel}>Taxa</Text>
                              </View>
                          </View>

                          <View style={{flexDirection:'row', alignItems:'center', marginTop:20, backgroundColor:'#222', padding:10, borderRadius:8, width:'100%'}}>
                              <Text style={{color:'#fff', flex:1, fontSize:14, marginRight:10}}>Desafio do Personagem Concluído?</Text>
                              <TouchableOpacity onPress={() => handleToggleChallenge(selectedCharacter)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: selectedCharacter.challenge_completed ? '#00B37E' : 'transparent'}}>
                                  {selectedCharacter.challenge_completed && <Ionicons name="checkmark" size={18} color="#fff" />}
                              </TouchableOpacity>
                          </View>

                          {loadingStats && <ActivityIndicator size="small" color="#8257e5" style={{marginTop:10}}/>}

                          <TouchableOpacity style={styles.closeButton} onPress={() => setDetailsModalVisible(false)}>
                              <Text style={styles.closeButtonText}>Fechar</Text>
                          </TouchableOpacity>
                      </View>
                  ) : <ActivityIndicator size="large" color="#8257e5"/>}
              </View>
          </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121214', paddingTop: 50 },
  
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30, paddingHorizontal: 20 },
  greeting: { color: '#E1E1E6', fontSize: 20, fontWeight: 'bold' },
  userEmail: { color: '#7C7C8A', fontSize: 12 },
  logoutButton: { padding: 8, backgroundColor: '#202024', borderRadius: 8 },

  loading: { flex: 1, backgroundColor: '#121214', justifyContent:'center', alignItems:'center' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 }, 
  matchmakingContainer: { backgroundColor: '#202024', padding: 20, borderRadius: 12, marginBottom: 25 },
  newGameButton: { backgroundColor: '#8257e5', borderRadius: 8, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  newGameIcon: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 10, borderRadius: 50, marginRight: 15 },
  newGameTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  newGameSubtitle: { color: '#E0D1FF', fontSize: 12 },
  joinContainer: { flexDirection: 'row' },
  joinInput: { flex: 1, backgroundColor: '#121214', color: '#fff', borderRadius: 8, paddingHorizontal: 15, marginRight: 10, borderWidth:1, borderColor:'#333', textAlign:'center', fontSize: 18, fontWeight:'bold' },
  joinButton: { backgroundColor: '#00B37E', borderRadius: 8, justifyContent: 'center', paddingHorizontal: 20 },
  joinButtonText: { color: '#fff', fontWeight: 'bold' },
  lobbyContainer: { flex: 1, backgroundColor: '#121214', padding: 20, paddingTop: 60 },
  lobbyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 },
  lobbyTitle: { color: '#fff', fontSize: 28, fontWeight: 'bold', letterSpacing: 2 },
  phaseTitle: { color: '#E1E1E6', fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  participantsList: { width: '100%', marginBottom: 30 },
  participantRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#202024', padding: 15, borderRadius: 8, marginBottom: 10 },
  participantName: { color: '#fff', marginLeft: 10, fontSize: 16 },
  actionButton: { backgroundColor: '#8257e5', padding: 20, borderRadius: 8, width: '100%', alignItems: 'center' },
  actionButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  actionsRow: { flexDirection: 'row', marginBottom: 25 },
  createButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', padding: 15, borderWidth: 1, borderColor: '#8257e5', borderRadius: 12 },
  createButtonText: { color: '#8257e5', fontWeight: 'bold', fontSize: 12 },
  sectionTitle: { color: '#E1E1E6', fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
  emptyText: { color: '#7C7C8A', marginTop: 10 },
  card: { backgroundColor: '#202024', padding: 12, borderRadius: 8, flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  charIcon: { width: 45, height: 45, borderRadius: 22.5, alignItems: 'center', justifyContent: 'center', marginRight: 15 },
  charImage: { width: 45, height: 45, borderRadius: 22.5, marginRight: 15, backgroundColor: '#333' },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cardSubtitle: { color: '#7C7C8A', fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding:20 },
  modalContent: { backgroundColor: '#18181B', borderRadius: 24, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  input: { backgroundColor: '#27272A', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#3F3F46' },
  saveButton: { backgroundColor: '#00875F', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  saveButtonText: { color: '#fff', fontWeight: 'bold' },
  catalogItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#333' },
  catalogImage: { width: 40, height: 40, borderRadius: 20, marginRight: 12, backgroundColor: '#333' },
  catalogInfo: { flex: 1 },
  catalogName: { color: '#fff', fontWeight: 'bold' },
  catalogOrigin: { color: '#888', fontSize: 12 },
  detailsImageBig: { width: 100, height: 100, borderRadius: 50, marginBottom: 15, backgroundColor: '#333' },
  detailsIconBig: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#29292E', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  detailsTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  detailsClass: { color: '#8257e5', fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase' },
  levelBigBadge: { marginTop: 20, alignItems: 'center', backgroundColor: '#3e2e6b', paddingVertical: 10, paddingHorizontal: 30, borderRadius: 12 },
  levelLabel: { color: '#D8B4FE', fontSize: 12, fontWeight: 'bold' },
  levelValue: { color: '#fff', fontSize: 36, fontWeight: 'bold' },
  closeButton: { backgroundColor: '#333', padding: 15, borderRadius: 8, marginTop: 20, width: '100%', alignItems: 'center' },
  closeButtonText: { color: '#fff' },
  sectionHeader: { color:'#8257e5', fontWeight:'bold', fontSize:12, marginBottom:10, letterSpacing:1 },
  skillForm: { backgroundColor:'#202024', padding:10, borderRadius:8 },
  typeBadge: { borderWidth:1, borderColor:'#555', padding:8, borderRadius:20, flex:1, marginHorizontal:2, alignItems:'center' },
  typeText: { color:'#fff', fontSize:10, fontWeight:'bold' },
  skillRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:10, borderBottomWidth:1, borderBottomColor:'#333' },
  imagePickerBtn: { width:'100%', height:150, backgroundColor:'#222', borderRadius:8, alignItems:'center', justifyContent:'center', borderStyle:'dashed', borderWidth:1, borderColor:'#555', marginBottom:20 },
  imagePreview: { width:'100%', height:'100%', borderRadius:8, resizeMode:'cover' },
  historyCard: { backgroundColor: '#202024', padding: 15, borderRadius: 12, marginBottom: 15, borderLeftWidth: 4, borderLeftColor: '#FFD700' },
  statsRow: { flexDirection:'row', justifyContent:'space-around', width:'100%', marginTop:25 },
  statBox: { alignItems:'center', backgroundColor:'#222', padding:10, borderRadius:8, width:'30%' },
  statValue: { color:'#fff', fontWeight:'bold', fontSize:18, marginTop:5 },
  statLabel: { color:'#777', fontSize:10 }
});