// src/screens/HomeScreen.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ScrollView, 
  RefreshControl, Alert, Modal, FlatList, TextInput, Image, KeyboardAvoidingView, Platform, ActivityIndicator 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { UserRosterItem, GameCharacter, Victory, GameEvent, Room, RoomParticipant, CharacterSkill, StatusEffect } from '../types/rpg';
import { Ionicons } from '@expo/vector-icons'; 
import { RealtimeChannel } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker'; // <--- IMPORTANTE
import * as FileSystem from 'expo-file-system'; // <--- IMPORTANTE

// --- PROPS ---
interface HomeScreenProps {
  onStartGame: (roomCode: string) => void;
}

const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

interface GameCharacterWithCreator extends GameCharacter { created_by?: string; }

export default function HomeScreen({ onStartGame }: HomeScreenProps) {
  // --- DADOS GERAIS ---
  const [playedCharacters, setPlayedCharacters] = useState<UserRosterItem[]>([]);
  const [catalogChars, setCatalogChars] = useState<GameCharacterWithCreator[]>([]);
  const [catalogEvents, setCatalogEvents] = useState<GameEvent[]>([]);
  const [catalogEffects, setCatalogEffects] = useState<StatusEffect[]>([]); 
  const [victories, setVictories] = useState<Victory[]>([]);
  
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

  // --- MODAIS DE GERENCIAMENTO ---
  const [createCharModalVisible, setCreateCharModalVisible] = useState(false);
  const [manageEventsModalVisible, setManageEventsModalVisible] = useState(false);
  const [createEventModalVisible, setCreateEventModalVisible] = useState(false);
  
  const [manageEffectsModalVisible, setManageEffectsModalVisible] = useState(false);
  const [createEffectModalVisible, setCreateEffectModalVisible] = useState(false);

  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<UserRosterItem | null>(null);

  // --- FORMULÁRIO PERSONAGEM (DADOS BÁSICOS) ---
  const [editingCharId, setEditingCharId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newOrigin, setNewOrigin] = useState('');
  const [newClass, setNewClass] = useState('');
  
  // IMAGEM
  const [newImage, setNewImage] = useState(''); // Guarda a URL final
  const [pickedImageUri, setPickedImageUri] = useState(''); // Guarda o caminho local temporário
  const [uploadingImage, setUploadingImage] = useState(false);

  const [newBaseHp, setNewBaseHp] = useState('10');

  // --- FORMULÁRIO PERSONAGEM (SKILLS) ---
  const [tempSkills, setTempSkills] = useState<Partial<CharacterSkill>[]>([]);
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillCost, setSkillCost] = useState('');
  const [skillDuration, setSkillDuration] = useState(''); 
  const [skillType, setSkillType] = useState<'active' | 'passive' | 'transformation'>('active');

  // --- FORMULÁRIO EVENTO ---
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventImage, setNewEventImage] = useState('');

  // --- FORMULÁRIO EFEITOS (BUFF/DEBUFF) ---
  const [editingEffectId, setEditingEffectId] = useState<string | null>(null);
  const [effectTitle, setEffectTitle] = useState('');
  const [effectDesc, setEffectDesc] = useState('');
  const [effectType, setEffectType] = useState<'buff' | 'debuff'>('buff');
  const [effectDamage, setEffectDamage] = useState('');
  const [effectDuration, setEffectDuration] = useState('');

  const [saving, setSaving] = useState(false);

  // --- FETCH DATA ---
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) { 
          setUserEmail(user.email || ''); 
          setUserId(user.id);
          const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single();
          setUsername(profile?.username || user.email?.split('@')[0] || 'Viajante');
      }
      const { data: roster } = await supabase.from('user_roster').select(`id, current_level, game_characters (id, name, anime_origin, base_class, image_url, base_hp)`).order('acquired_at', { ascending: false });
      setPlayedCharacters(roster as any || []);
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

  useEffect(() => { fetchData(); }, []);

  // --- LOGICA DE IMAGEM (PICKER + UPLOAD) ---
  const pickImage = async () => {
    // Pede permissão e abre galeria
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1], // Quadrado
      quality: 0.5,   // Qualidade média para não ficar pesado
    });

    if (!result.canceled) {
      setPickedImageUri(result.assets[0].uri);
    }
  };

  const uploadToSupabase = async (uri: string): Promise<string | null> => {
    try {
        setUploadingImage(true);
        
        // 1. Lê o arquivo como blob/base64
        const response = await fetch(uri);
        const blob = await response.blob();
        
        // 2. Cria nome único
        const fileExt = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `${fileName}`;

        // 3. Upload para o bucket 'rpg-images'
        const { error: uploadError } = await supabase.storage
            .from('rpg-images')
            .upload(filePath, blob);

        if (uploadError) throw uploadError;

        // 4. Pega URL Pública
        const { data } = supabase.storage.from('rpg-images').getPublicUrl(filePath);
        return data.publicUrl;

    } catch (error: any) {
        Alert.alert("Erro no upload", error.message);
        return null;
    } finally {
        setUploadingImage(false);
    }
  };

  // --- MULTIPLAYER LOGIC ---
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
    const { error } = await supabase.from('rooms').insert({ code, host_id: userId, status: 'waiting' });
    if (error) return Alert.alert('Erro', 'Tente novamente.');
    await supabase.from('room_participants').insert({ room_code: code, user_id: userId, user_email: userEmail, username });
    setCurrentRoom({ code, host_id: userId, status: 'waiting' });
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
    const existing = playedCharacters.find(p => p.game_characters.id === charId);
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
            const initialHp = charData?.base_hp || 10;
            // Reseta HP e Status
            await supabase.from('room_participants').update({ 
                turn_order: i + 1, 
                current_hp: initialHp, 
                max_hp: initialHp, 
                buffs: '', 
                debuffs: '',
                active_transformations: [] 
            }).eq('id', shuffled[i].id);
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

  // ==============================================================================
  // CRUD PERSONAGEM COM SKILLS
  // ==============================================================================
  
  const openCreateCharModal = () => {
    setEditingCharId(null);
    setNewName(''); setNewOrigin(''); setNewClass(''); setNewImage(''); setNewBaseHp('10');
    setPickedImageUri(''); // Reseta imagem local
    setTempSkills([]); 
    setCreateCharModalVisible(true);
  };

  const openEditCharModal = async (char: GameCharacterWithCreator) => {
    setEditingCharId(char.id);
    setNewName(char.name); 
    setNewOrigin(char.anime_origin); 
    setNewClass(char.base_class); 
    setNewImage(char.image_url || ''); // Guarda a URL do banco
    setPickedImageUri(''); // Reseta a local
    setNewBaseHp(String(char.base_hp || 10));
    
    const { data: skills } = await supabase.from('character_skills').select('*').eq('character_id', char.id);
    if(skills) {
        setTempSkills(skills.map(s => ({
            name: s.name, description: s.description, type: s.type as any, cost: s.cost || '', duration: s.duration || 0
        })));
    } else {
        setTempSkills([]);
    }

    setLobbyModalVisible(false); 
    setCreateCharModalVisible(true);
  };

  const addSkillToTempList = () => {
      if (!skillName) return Alert.alert("Ops", "Dê um nome para a habilidade");
      const newSkill: Partial<CharacterSkill> = {
          name: skillName, description: skillDesc, cost: skillCost, type: skillType,
          duration: parseInt(skillDuration) || 0
      };
      setTempSkills([...tempSkills, newSkill]);
      setSkillName(''); setSkillDesc(''); setSkillCost(''); setSkillDuration('');
  };

  const removeSkillFromTemp = (index: number) => {
      const updated = [...tempSkills];
      updated.splice(index, 1);
      setTempSkills(updated);
  };

  const handleDeleteChar = async (id: string) => {
    Alert.alert("Excluir", "Tem certeza?", [
        { text: "Cancelar" },
        { text: "Excluir", onPress: async () => {
            await supabase.from('game_characters').delete().eq('id', id);
            fetchCatalogs();
        }}
    ]);
  };

  const handleSaveChar = async () => {
    if(!newName || !newOrigin || !newClass) return Alert.alert("Erro", "Preencha os dados básicos");
    setSaving(true);
    
    try {
        // --- LÓGICA DE UPLOAD ---
        let finalImageUrl = newImage; // Começa com o que já tem (ou vazio)
        
        // Se usuário escolheu uma imagem nova da galeria, faz upload
        if (pickedImageUri) {
            const uploadedUrl = await uploadToSupabase(pickedImageUri);
            if (uploadedUrl) finalImageUrl = uploadedUrl;
            else throw new Error("Falha no upload da imagem");
        }

        const hpInt = parseInt(newBaseHp) || 10;
        const charPayload = {
            name: newName, 
            anime_origin: newOrigin, 
            base_class: newClass, 
            image_url: finalImageUrl || null, 
            base_hp: hpInt
        };
        
        let charId = editingCharId;

        if(editingCharId) {
            await supabase.from('game_characters').update(charPayload).eq('id', editingCharId);
            await supabase.from('character_skills').delete().eq('character_id', editingCharId);
        } else {
            const { data, error } = await supabase.from('game_characters').insert(charPayload).select().single();
            if (error) throw error;
            charId = data.id;
        }

        if (charId && tempSkills.length > 0) {
            const skillsToInsert = tempSkills.map(s => ({
                character_id: charId,
                name: s.name, description: s.description, type: s.type, cost: s.cost, duration: s.duration
            }));
            const { error: skillError } = await supabase.from('character_skills').insert(skillsToInsert);
            if (skillError) throw skillError;
        }

        Alert.alert("Sucesso", "Personagem salvo!");
        setCreateCharModalVisible(false); 
        fetchCatalogs();
        if(currentRoom) setLobbyModalVisible(true);

    } catch (e: any) {
        Alert.alert("Erro ao salvar", e.message);
    } finally {
        setSaving(false);
        setUploadingImage(false);
    }
  };

  // --- CRUD EVENTOS ---
  const openCreateEventModal = () => { setEditingEventId(null); setNewEventTitle(''); setNewEventDesc(''); setNewEventImage(''); setCreateEventModalVisible(true); };
  const openEditEventModal = (ev: GameEvent) => { setEditingEventId(ev.id); setNewEventTitle(ev.title); setNewEventDesc(ev.description); setNewEventImage(ev.image_url||''); setCreateEventModalVisible(true); }
  const handleSaveEvent = async () => { if(!newEventTitle) return; const p = {title:newEventTitle, description:newEventDesc, image_url:newEventImage||null}; if(editingEventId) await supabase.from('game_events').update(p).eq('id',editingEventId); else await supabase.from('game_events').insert(p); setCreateEventModalVisible(false); fetchCatalogs(); };
  const deleteEvent = async(id:string) => { await supabase.from('game_events').delete().eq('id',id); fetchCatalogs(); }

  // --- CRUD EFEITOS ---
  const openCreateEffectModal = () => { setEditingEffectId(null); setEffectTitle(''); setEffectDesc(''); setEffectDamage(''); setEffectDuration(''); setEffectType('buff'); setCreateEffectModalVisible(true); };
  const openEditEffectModal = (eff: StatusEffect) => { setEditingEffectId(eff.id); setEffectTitle(eff.title); setEffectDesc(eff.description); setEffectType(eff.type); setEffectDamage(eff.damage || ''); setEffectDuration(String(eff.duration || '')); setCreateEffectModalVisible(true); };
  const handleSaveEffect = async () => { if(!effectTitle) return Alert.alert("Erro", "Título é obrigatório"); const p = { title: effectTitle, description: effectDesc, type: effectType, damage: effectType === 'debuff' ? effectDamage : null, duration: parseInt(effectDuration) || 0 }; if(editingEffectId) await supabase.from('game_status_effects').update(p).eq('id', editingEffectId); else await supabase.from('game_status_effects').insert(p); setCreateEffectModalVisible(false); fetchCatalogs(); };
  const deleteEffect = async(id:string) => { await supabase.from('game_status_effects').delete().eq('id',id); fetchCatalogs(); };

  const renderPlayedChar = (item: UserRosterItem) => ( <TouchableOpacity key={item.id} style={styles.card} onPress={() => { setSelectedCharacter(item); setDetailsModalVisible(true); }}> {item.game_characters.image_url ? <Image source={{ uri: item.game_characters.image_url }} style={styles.charImage} /> : <View style={[styles.charIcon, { backgroundColor: '#3e2e6b' }]}><Text style={{fontSize: 20}}>⚔️</Text></View>} <View style={{flex: 1}}><Text style={styles.cardTitle}>{item.game_characters.name}</Text><Text style={styles.cardSubtitle}>Nível {1 + victories.filter(v => v.character_name === item.game_characters.name).length} • {item.game_characters.base_class}</Text></View> </TouchableOpacity> );

  return (
    <View style={styles.container}>
      <View style={styles.header}><View><Text style={styles.greeting}>Olá, {username}</Text><Text style={styles.userEmail}>{userEmail}</Text></View><TouchableOpacity onPress={async () => await supabase.auth.signOut()} style={styles.logoutButton}><Ionicons name="log-out-outline" size={24} color="#ff4444" /></TouchableOpacity></View>
      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor="#8257e5"/>}>
        <View style={styles.matchmakingContainer}><Text style={styles.sectionTitle}>Multiplayer</Text><TouchableOpacity style={styles.newGameButton} onPress={() => { handleCreateRoom(); fetchCatalogs(); }}><View style={styles.newGameIcon}><Ionicons name="add" size={32} color="#fff" /></View><View><Text style={styles.newGameTitle}>CRIAR SALA</Text><Text style={styles.newGameSubtitle}>Seja o Host da partida</Text></View></TouchableOpacity><View style={styles.joinContainer}><TextInput style={styles.joinInput} placeholder="CÓDIGO" placeholderTextColor="#555" maxLength={4} autoCapitalize="characters" value={joinCode} onChangeText={setJoinCode}/><TouchableOpacity style={styles.joinButton} onPress={() => { handleJoinRoom(); fetchCatalogs(); }}><Text style={styles.joinButtonText}>ENTRAR</Text></TouchableOpacity></View></View>
        <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.createButton, {flex: 1, marginRight: 5}]} onPress={openCreateCharModal}><Ionicons name="person-add" size={18} color="#8257e5" style={{marginRight: 5}}/><Text style={styles.createButtonText}>Add Char</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.createButton, {flex: 1, marginHorizontal: 5, borderColor: '#00B37E'}]} onPress={() => { setManageEventsModalVisible(true); fetchCatalogs(); }}><Ionicons name="library" size={18} color="#00B37E" style={{marginRight: 5}}/><Text style={[styles.createButtonText, {color: '#00B37E'}]}>Eventos</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.createButton, {flex: 1, marginLeft: 5, borderColor: '#FFD700'}]} onPress={() => { setManageEffectsModalVisible(true); fetchCatalogs(); }}><Ionicons name="flask" size={18} color="#FFD700" style={{marginRight: 5}}/><Text style={[styles.createButtonText, {color: '#FFD700'}]}>Efeitos</Text></TouchableOpacity>
        </View>
        <Text style={styles.sectionTitle}>Seu Histórico</Text>{playedCharacters.length === 0 ? <Text style={styles.emptyText}>Sem histórico.</Text> : playedCharacters.map(item => renderPlayedChar(item))}
      </ScrollView>

      {/* LOBBY MODAL */}
      <Modal animationType="slide" transparent={false} visible={lobbyModalVisible} onRequestClose={()=>{}}><View style={styles.lobbyContainer}><View style={styles.lobbyHeader}><Text style={styles.lobbyTitle}>Sala: {currentRoom?.code}</Text><TouchableOpacity onPress={handleLeaveRoom}><Ionicons name="close-circle" size={32} color="#ff4444" /></TouchableOpacity></View>{currentRoom?.status === 'waiting' && (<View style={{flex: 1, justifyContent:'center', alignItems:'center'}}><Text style={styles.phaseTitle}>Aguardando...</Text><View style={styles.participantsList}>{participants.map(p => (<View key={p.id} style={styles.participantRow}><Ionicons name="person" size={20} color="#fff" /><Text style={styles.participantName}>{p.username}</Text>{p.user_id === currentRoom.host_id && <Text style={{color:'#FFD700', marginLeft:5}}>👑</Text>}</View>))}</View>{userId === currentRoom.host_id ? <TouchableOpacity style={styles.actionButton} onPress={handleStartSelection}><Text style={styles.actionButtonText}>INICIAR SELEÇÃO</Text></TouchableOpacity> : <Text style={{color:'#777'}}>Aguardando Host...</Text>}</View>)}{currentRoom?.status === 'selecting' && (<View style={{flex: 1}}><Text style={styles.phaseTitle}>Escolha seu Herói</Text><Text style={{color:'#ccc', textAlign:'center', marginBottom:10}}>{participants.filter(p => p.is_ready).length} / {participants.length} prontos</Text>{participants.find(p => p.user_id === userId)?.is_ready ? (<View style={{flex:1, justifyContent:'center', alignItems:'center'}}><Ionicons name="checkmark-circle" size={64} color="#00B37E" /><Text style={{color:'#fff', marginTop:10}}>Selecionado!</Text>{userId === currentRoom.host_id && participants.every(p => p.is_ready) && (<TouchableOpacity style={[styles.actionButton, {marginTop:30, backgroundColor:'#FFD700'}]} onPress={handleStartGame} disabled={saving}><Text style={[styles.actionButtonText, {color:'#000'}]}>INICIAR PARTIDA</Text></TouchableOpacity>)}</View>) : (<FlatList data={catalogChars} keyExtractor={item => item.id} renderItem={({item}) => (<View style={styles.catalogItem}><TouchableOpacity style={{flex: 1, flexDirection:'row', alignItems:'center'}} onPress={() => handleSelectCharacter(item.id)}>{item.image_url && <Image source={{uri: item.image_url}} style={styles.catalogImage} />}<View style={styles.catalogInfo}><Text style={styles.catalogName}>{item.name} (HP: {item.base_hp})</Text><Text style={styles.catalogOrigin}>{item.base_class}</Text></View><Ionicons name="arrow-forward-circle" size={32} color="#8257e5" /></TouchableOpacity><View style={{flexDirection:'row', marginLeft: 10}}><TouchableOpacity onPress={() => openEditCharModal(item)} style={{padding:5}}><Ionicons name="pencil" size={20} color="#8257e5" /></TouchableOpacity><TouchableOpacity onPress={() => handleDeleteChar(item.id)} style={{padding:5}}><Ionicons name="trash" size={20} color="#ff4444" /></TouchableOpacity></View></View>)}/>)}</View>)}</View></Modal>

      {/* --- MODAL CRIAR/EDITAR PERSONAGEM --- */}
      <Modal transparent visible={createCharModalVisible} animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, {maxHeight: '90%'}]}>
            <ScrollView>
                <Text style={styles.modalTitle}>{editingCharId ? "Editar Personagem" : "Novo Personagem"}</Text>
                
                <Text style={styles.sectionHeader}>DADOS BÁSICOS</Text>
                <TextInput style={styles.input} placeholder="Nome" placeholderTextColor="#555" value={newName} onChangeText={setNewName}/>
                <TextInput style={styles.input} placeholder="Origem" placeholderTextColor="#555" value={newOrigin} onChangeText={setNewOrigin}/>
                <TextInput style={styles.input} placeholder="Classe" placeholderTextColor="#555" value={newClass} onChangeText={setNewClass}/>
                <TextInput style={styles.input} placeholder="Vida Máxima (Ex: 10)" placeholderTextColor="#555" value={newBaseHp} onChangeText={setNewBaseHp} keyboardType="numeric"/>

                {/* AREA DE UPLOAD DE IMAGEM */}
                <Text style={[styles.sectionHeader, {marginTop:10}]}>IMAGEM DO PERSONAGEM</Text>
                <TouchableOpacity onPress={pickImage} style={styles.imagePickerBtn}>
                    {pickedImageUri ? (
                        <Image source={{ uri: pickedImageUri }} style={styles.imagePreview} />
                    ) : newImage ? (
                        <Image source={{ uri: newImage }} style={styles.imagePreview} />
                    ) : (
                        <View style={{alignItems:'center'}}>
                            <Ionicons name="image-outline" size={40} color="#777" />
                            <Text style={{color:'#777', marginTop:5}}>Toque para selecionar da galeria</Text>
                        </View>
                    )}
                </TouchableOpacity>

                <Text style={[styles.sectionHeader, {marginTop:20}]}>ADICIONAR HABILIDADE / TRANSFORMAÇÃO</Text>
                <View style={styles.skillForm}>
                    <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Nome Skill" placeholderTextColor="#555" value={skillName} onChangeText={setSkillName}/>
                    <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Descrição" placeholderTextColor="#555" value={skillDesc} onChangeText={setSkillDesc}/>
                    <TextInput style={[styles.input, {marginBottom:10}]} placeholder="Custo (Ex: 10 Mana)" placeholderTextColor="#555" value={skillCost} onChangeText={setSkillCost}/>
                    <TextInput style={[styles.input, {marginBottom:10, borderColor: skillDuration ? '#FFD700' : '#3F3F46'}]} placeholder="Duração (rodadas)" placeholderTextColor="#555" value={skillDuration} onChangeText={setSkillDuration} keyboardType="numeric"/>

                    <View style={{flexDirection:'row', justifyContent:'space-around', marginBottom:15}}>
                        <TouchableOpacity onPress={()=>setSkillType('active')} style={[styles.typeBadge, skillType==='active' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>Ativa</Text></TouchableOpacity>
                        <TouchableOpacity onPress={()=>setSkillType('passive')} style={[styles.typeBadge, skillType==='passive' && {backgroundColor:'#8257e5', borderColor:'#8257e5'}]}><Text style={styles.typeText}>Passiva</Text></TouchableOpacity>
                        <TouchableOpacity onPress={()=>setSkillType('transformation')} style={[styles.typeBadge, skillType==='transformation' && {backgroundColor:'#FFD700', borderColor:'#FFD700'}]}><Text style={[styles.typeText, skillType==='transformation' && {color:'black'}]}>Transform</Text></TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={addSkillToTempList} style={[styles.saveButton, {marginTop:0, backgroundColor:'#333', borderColor:'#555', borderWidth:1}]}><Text style={{color:'#fff'}}>+ Adicionar na Lista</Text></TouchableOpacity>
                </View>

                {tempSkills.length > 0 && (<View style={{marginTop:15}}><Text style={{color:'#ccc', marginBottom:5}}>Lista de Habilidades ({tempSkills.length}):</Text>{tempSkills.map((s, index) => (<View key={index} style={styles.skillRow}><View style={{flex:1}}><Text style={{color:'#fff', fontWeight:'bold'}}>{s.name} <Text style={{fontSize:10, color: s.type === 'transformation' ? '#FFD700' : '#888'}}>({s.type?.toUpperCase()}{s.duration ? ` - ${s.duration} Rnds` : ''})</Text></Text><Text style={{color:'#777', fontSize:10}}>{s.description}</Text></View><TouchableOpacity onPress={() => removeSkillFromTemp(index)}><Ionicons name="trash" size={18} color="#ff4444" /></TouchableOpacity></View>))}</View>)}
                <View style={{height:20}} />
            </ScrollView>

            <View style={{marginTop:10}}>
                <TouchableOpacity onPress={handleSaveChar} style={styles.saveButton} disabled={saving}>
                    {uploadingImage ? <ActivityIndicator color="#fff"/> : <Text style={styles.saveButtonText}>{saving ? "Salvando..." : (editingCharId ? "ATUALIZAR" : "CRIAR")}</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={()=>{setCreateCharModalVisible(false); if(currentRoom) setLobbyModalVisible(true);}} style={[styles.saveButton,{backgroundColor:'#222', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      
      {/* MODAL EVENTOS E EFEITOS (Resumidos para caber) */}
      <Modal transparent visible={manageEventsModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Eventos</Text><TouchableOpacity onPress={openCreateEventModal}><Ionicons name="add-circle" size={28} color="#00B37E"/></TouchableOpacity><TouchableOpacity onPress={()=>setManageEventsModalVisible(false)}><Ionicons name="close" size={24} color="#ccc"/></TouchableOpacity></View><FlatList data={catalogEvents} keyExtractor={i=>i.id} renderItem={({item})=>(<View style={styles.catalogItem}><View style={{flex:1}}><Text style={styles.catalogName}>{item.title}</Text></View><TouchableOpacity onPress={()=>openEditEventModal(item)} style={{marginRight:15}}><Ionicons name="pencil" size={20} color="#8257e5"/></TouchableOpacity><TouchableOpacity onPress={()=>deleteEvent(item.id)}><Ionicons name="trash" size={20} color="red"/></TouchableOpacity></View>)}/></View></View></Modal>
      <Modal transparent visible={createEventModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>Criar Evento</Text><TextInput style={styles.input} placeholder="Título" placeholderTextColor="#555" value={newEventTitle} onChangeText={setNewEventTitle}/><TextInput style={styles.input} placeholder="Descrição" placeholderTextColor="#555" value={newEventDesc} onChangeText={setNewEventDesc}/><TextInput style={styles.input} placeholder="URL Imagem" placeholderTextColor="#555" value={newEventImage} onChangeText={setNewEventImage}/><TouchableOpacity onPress={handleSaveEvent} style={styles.saveButton}><Text style={styles.saveButtonText}>SALVAR</Text></TouchableOpacity><TouchableOpacity onPress={()=>setCreateEventModalVisible(false)} style={[styles.saveButton,{backgroundColor:'#333', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity></View></View></Modal>
      <Modal transparent visible={manageEffectsModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Buffs & Debuffs</Text><TouchableOpacity onPress={openCreateEffectModal}><Ionicons name="add-circle" size={28} color="#00B37E"/></TouchableOpacity><TouchableOpacity onPress={()=>setManageEffectsModalVisible(false)}><Ionicons name="close" size={24} color="#ccc"/></TouchableOpacity></View><FlatList data={catalogEffects} keyExtractor={i=>i.id} renderItem={({item})=>(<View style={styles.catalogItem}><View style={{flex:1}}><Text style={[styles.catalogName, {color: item.type==='buff'?'#00B37E':'#ff4444'}]}>{item.title}</Text><Text style={styles.catalogOrigin}>{item.type.toUpperCase()}{item.duration ? ` • ${item.duration} Rnds` : ''}</Text></View><TouchableOpacity onPress={()=>openEditEffectModal(item)} style={{marginRight:15}}><Ionicons name="pencil" size={20} color="#8257e5"/></TouchableOpacity><TouchableOpacity onPress={()=>deleteEffect(item.id)}><Ionicons name="trash" size={20} color="red"/></TouchableOpacity></View>)}/></View></View></Modal>
      <Modal transparent visible={createEffectModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>{editingEffectId ? "Editar Efeito" : "Criar Efeito"}</Text><View style={{flexDirection:'row', marginBottom:15}}><TouchableOpacity onPress={()=>setEffectType('buff')} style={[styles.typeBadge, effectType==='buff' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>BUFF (Bom)</Text></TouchableOpacity><TouchableOpacity onPress={()=>setEffectType('debuff')} style={[styles.typeBadge, effectType==='debuff' && {backgroundColor:'#ff4444', borderColor:'#ff4444'}]}><Text style={styles.typeText}>DEBUFF (Ruim)</Text></TouchableOpacity></View><TextInput style={styles.input} placeholder="Título (Ex: Veneno)" placeholderTextColor="#555" value={effectTitle} onChangeText={setEffectTitle}/><TextInput style={styles.input} placeholder="Descrição" placeholderTextColor="#555" value={effectDesc} onChangeText={setEffectDesc}/><TextInput style={styles.input} placeholder="Duração" placeholderTextColor="#555" value={effectDuration} onChangeText={setEffectDuration} keyboardType="numeric"/>{effectType === 'debuff' && (<TextInput style={[styles.input, {borderColor:'#ff4444'}]} placeholder="Dano (Ex: 10)" placeholderTextColor="#555" value={effectDamage} onChangeText={setEffectDamage}/>)}<TouchableOpacity onPress={handleSaveEffect} style={styles.saveButton}><Text style={styles.saveButtonText}>SALVAR</Text></TouchableOpacity><TouchableOpacity onPress={()=>setCreateEffectModalVisible(false)} style={[styles.saveButton,{backgroundColor:'#333', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity></View></View></Modal>
      <Modal animationType="fade" transparent={true} visible={detailsModalVisible} onRequestClose={() => setDetailsModalVisible(false)}><View style={styles.modalOverlay}><View style={[styles.modalContent, { height: '60%' }]}>{selectedCharacter && (<View style={{alignItems: 'center'}}>{selectedCharacter.game_characters.image_url ? <Image source={{uri: selectedCharacter.game_characters.image_url}} style={styles.detailsImageBig} /> : <View style={styles.detailsIconBig}><Text style={{fontSize: 40}}>👤</Text></View>}<Text style={styles.detailsTitle}>{selectedCharacter.game_characters.name}</Text><Text style={styles.detailsClass}>{selectedCharacter.game_characters.base_class}</Text><View style={styles.levelBigBadge}><Text style={styles.levelLabel}>HP BASE: {selectedCharacter.game_characters.base_hp}</Text></View><TouchableOpacity style={styles.closeButton} onPress={() => setDetailsModalVisible(false)}><Text style={styles.closeButtonText}>Fechar</Text></TouchableOpacity></View>)}</View></View></Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121214', paddingTop: 50 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30, paddingHorizontal: 20 },
  greeting: { color: '#E1E1E6', fontSize: 20, fontWeight: 'bold' },
  userEmail: { color: '#7C7C8A', fontSize: 12 },
  logoutButton: { padding: 8, backgroundColor: '#202024', borderRadius: 8 },
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
  closeButton: { backgroundColor: '#333', padding: 15, borderRadius: 8, marginTop: 30, width: '100%', alignItems: 'center' },
  closeButtonText: { color: '#fff' },
  sectionHeader: { color:'#8257e5', fontWeight:'bold', fontSize:12, marginBottom:10, letterSpacing:1 },
  skillForm: { backgroundColor:'#202024', padding:10, borderRadius:8 },
  typeBadge: { borderWidth:1, borderColor:'#555', padding:8, borderRadius:20, flex:1, marginHorizontal:2, alignItems:'center' },
  typeText: { color:'#fff', fontSize:10, fontWeight:'bold' },
  skillRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:10, borderBottomWidth:1, borderBottomColor:'#333' },
  
  // ESTILOS DE UPLOAD IMAGEM
  imagePickerBtn: { width:'100%', height:150, backgroundColor:'#222', borderRadius:8, alignItems:'center', justifyContent:'center', borderStyle:'dashed', borderWidth:1, borderColor:'#555', marginBottom:20 },
  imagePreview: { width:'100%', height:'100%', borderRadius:8, resizeMode:'cover' }
});