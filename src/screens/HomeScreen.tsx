import React, { useEffect, useState, useCallback, useRef } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ScrollView, 
  RefreshControl, Alert, Modal, FlatList, TextInput, Image, ActivityIndicator 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { UserRosterItem, GameEvent, Room, RoomParticipant, MatchHistoryItem, StatusEffect } from '../types/rpg';
import { Ionicons } from '@expo/vector-icons'; 
import { RealtimeChannel } from '@supabase/supabase-js';

// --- IMPORTAÇÃO DOS NOVOS COMPONENTES MODULARES ---
import CharacterEditor from './CharacterEditor';
import EventManager from './EventManager';

interface HomeScreenProps {
  onStartGame: (roomCode: string) => void;
}

// Interfaces Auxiliares mantidas para o Lobby/Stats
interface GameCharacterWithCreator { 
    id: string;
    name: string;
    base_class: string;
    image_url?: string;
    category: 'individual' | 'equipe' | 'hit';
    base_hp: number;
    base_shield?: number;
    challenge_banner_url?: string;
    // ... outros campos se necessário para exibição
}

const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

export default function HomeScreen({ onStartGame }: HomeScreenProps) {
  // ==================================================================================
  // 1. STATES GERAIS E DE NAVEGAÇÃO
  // ==================================================================================
  const [playedCharacters, setPlayedCharacters] = useState<UserRosterItem[]>([]);
  const [catalogChars, setCatalogChars] = useState<GameCharacterWithCreator[]>([]);
  const [catalogEvents, setCatalogEvents] = useState<GameEvent[]>([]);
  const [matchHistory, setMatchHistory] = useState<MatchHistoryItem[]>([]);
  const [victories, setVictories] = useState<any[]>([]); // Tipagem simplificada
  
  // UI & Auth
  const [userEmail, setUserEmail] = useState('');
  const [username, setUsername] = useState(''); 
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Stats Modal
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<UserRosterItem | null>(null);
  const [selectedCharStats, setSelectedCharStats] = useState({ matches: 0, wins: 0, winRate: 0, missions: 0 });
  const [loadingStats, setLoadingStats] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);

  // ==================================================================================
  // 2. NOVOS CONTROLES DE MODAL (REFATORADO)
  // ==================================================================================
  const [charEditorVisible, setCharEditorVisible] = useState(false);
  const [charToEdit, setCharToEdit] = useState<any>(null); // Objeto do personagem para edição

  const [eventManagerVisible, setEventManagerVisible] = useState(false);

  // ==================================================================================
  // 3. LÓGICA DE SALA (LOBBY) - MANTIDA AQUI
  // ==================================================================================
  const [lobbyModalVisible, setLobbyModalVisible] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [joinCode, setJoinCode] = useState(''); 
  const roomChannelRef = useRef<RealtimeChannel | null>(null);
  
  const [eventSelectionMode, setEventSelectionMode] = useState<'random' | 'manual'>('random');
  const [lobbySelectedEventId, setLobbySelectedEventId] = useState<string | null>(null);

  // ==================================================================================
  // 4. EFEITOS (STATUS EFFECTS) - MANTIDO SIMPLIFICADO
  // ==================================================================================
  // Nota: Idealmente mover para um "EffectsManager.tsx", mas mantive aqui para não quebrar funcionalidades não migradas.
  const [catalogEffects, setCatalogEffects] = useState<StatusEffect[]>([]); 
  const [manageEffectsModalVisible, setManageEffectsModalVisible] = useState(false);
  const [createEffectModalVisible, setCreateEffectModalVisible] = useState(false);
  const [editingEffectId, setEditingEffectId] = useState<string | null>(null);
  const [effectTitle, setEffectTitle] = useState('');
  const [effectDesc, setEffectDesc] = useState('');
  const [effectType, setEffectType] = useState<'buff' | 'debuff'>('buff');
  const [effectDamage, setEffectDamage] = useState('');
  const [effectDuration, setEffectDuration] = useState('');


  // ==================================================================================
  // 5. DATA FETCHING & AUTH
  // ==================================================================================
  
  const fetchCatalogs = async () => { 
      const { data: chars } = await supabase.from('game_characters').select('*').order('name'); 
      if (chars) setCatalogChars(chars as any); 
      
      const { data: events } = await supabase.from('game_events').select('*').order('title'); 
      if (events) setCatalogEvents(events); 
      
      const { data: effects } = await supabase.from('game_status_effects').select('*').order('title'); 
      if (effects) setCatalogEffects(effects); 
  };
  
  const fetchData = useCallback(async () => { 
    try { 
        setLoading(true); 
        const { data: { user } } = await supabase.auth.getUser(); 
        if (user) { 
            setUserEmail(user.email || ''); 
            setUserId(user.id); 
            const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single(); 
            setUsername(profile?.username || user.email?.split('@')[0] || 'Viajante'); 
            
            const { data: roster, error } = await supabase.from('user_roster').select(`id, current_level, acquired_at, challenge_completed, game_characters (*)`).eq('user_id', user.id).order('acquired_at', { ascending: false }); 
            if (!error) setPlayedCharacters(roster as any || []); 
        } 
        const { data: vict } = await supabase.from('victories').select('*'); 
        setVictories(vict || []); 
        await fetchCatalogs(); 
    } catch (error: any) { 
        console.log(error); 
    } finally { 
        setLoading(false); 
        setRefreshing(false); 
    } 
  }, []);

  useEffect(() => { fetchData(); }, []);
  
  // Atualiza catálogos quando o lobby abre (para pegar novos chars criados)
  useEffect(() => { if (lobbyModalVisible) fetchCatalogs(); }, [lobbyModalVisible]);

  const fetchHistory = async () => { 
      setLoading(true); 
      const { data } = await supabase.from('match_history').select('*').order('played_at', { ascending: false }).limit(10); 
      if (data) setMatchHistory(data); 
      setLoading(false); 
      setHistoryModalVisible(true); 
  };

  // ==================================================================================
  // 6. FUNÇÕES DE AÇÃO (LOBBY & GAME)
  // ==================================================================================

  const fetchParticipants = async (code: string) => { const { data } = await supabase.from('room_participants').select('*').eq('room_code', code); if (data) setParticipants(data); };
  
  const subscribeToRoom = (roomCode: string) => { 
      if (roomChannelRef.current) supabase.removeChannel(roomChannelRef.current); 
      const channel = supabase.channel(`room_${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` }, (payload) => { 
          const updatedRoom = payload.new as Room; 
          setCurrentRoom(updatedRoom); 
          if (updatedRoom.status === 'playing') { 
              setLobbyModalVisible(false); 
              onStartGame(roomCode); 
          } 
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_code=eq.${roomCode}` }, () => fetchParticipants(roomCode))
      .subscribe(); 
      roomChannelRef.current = channel; 
  };

  const handleCreateRoom = async () => { 
      let currentUserId = userId; 
      let currentUserEmail = userEmail; 
      if (!currentUserId) { 
          const { data: { user } } = await supabase.auth.getUser(); 
          if (!user) return Alert.alert("Erro", "Você precisa estar logado."); 
          currentUserId = user.id; 
          currentUserEmail = user.email || ''; 
          setUserId(currentUserId); setUserEmail(currentUserEmail); 
      } 
      const code = generateRoomCode(); 
      const { data, error } = await supabase.from('rooms').insert({ code, host_id: currentUserId, status: 'waiting' }).select().single(); 
      if (error) return Alert.alert('Erro ao criar sala', error.message); 
      
      await supabase.from('room_participants').insert({ room_code: code, user_id: currentUserId, user_email: currentUserEmail, username }); 
      
      setCurrentRoom(data); 
      setParticipants([{ id: 'local', room_code: code, user_id: currentUserId, user_email: currentUserEmail, username, is_ready: false, current_hp: 10, max_hp: 10 }]); 
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

  const handleLeaveRoom = async () => { 
      if (currentRoom) { 
          if (roomChannelRef.current) supabase.removeChannel(roomChannelRef.current); 
          await supabase.from('room_participants').delete().eq('room_code', currentRoom.code).eq('user_id', userId); 
      } 
      setLobbyModalVisible(false); 
      setCurrentRoom(null); 
      setParticipants([]); 
  };

  const handleStartSelection = async () => { if (!currentRoom) return; await supabase.from('rooms').update({ status: 'selecting' }).eq('code', currentRoom.code); };
  
  const handleSelectCharacter = async (charId: string) => { 
      if (!currentRoom) return; 
      await supabase.from('room_participants').update({ selected_character_id: charId, is_ready: true }).eq('room_code', currentRoom.code).eq('user_id', userId); 
      const existing = playedCharacters.find(p => p.game_characters && p.game_characters.id === charId); 
      if (!existing) { await supabase.from('user_roster').insert({ user_id: userId, character_id: charId, current_level: 1 }); fetchData(); } 
  };

  const handleStartGame = async () => { 
      if (!currentRoom) return; 
      let finalEventId = '';
      if (eventSelectionMode === 'random') {
         let availableEvents = catalogEvents; 
         if (availableEvents.length === 0) return Alert.alert('Erro', 'Nenhum evento disponível.');
         const randomEvent = availableEvents[Math.floor(Math.random() * availableEvents.length)];
         finalEventId = randomEvent.id;
      } else {
         if (!lobbySelectedEventId) return Alert.alert("Atenção", "Selecione um evento da lista!");
         finalEventId = lobbySelectedEventId;
      }

      const everyoneReady = participants.every(p => p.is_ready); 
      if (!everyoneReady) return Alert.alert('Aguarde', 'Jogadores escolhendo...'); 
      
      try { 
          const shuffled = [...participants].sort(() => Math.random() - 0.5); 
          for (let i = 0; i < shuffled.length; i++) { 
              const selectedCharId = shuffled[i].selected_character_id; 
              const charData = catalogChars.find(c => c.id === selectedCharId); 
              let initialHp = 10; let initialShield = charData?.base_shield || 0; let initialTeamState: any[] = []; 
              if (charData?.category === 'equipe') { initialHp = 0; initialTeamState = []; } else { initialHp = charData?.base_hp || 10; } 
              await supabase.from('room_participants').update({ turn_order: i + 1, current_hp: initialHp, max_hp: initialHp, current_shield: initialShield, buffs: '', debuffs: '', active_transformations: [], team_state: initialTeamState }).eq('id', shuffled[i].id); 
          } 
          await supabase.from('rooms').update({ status: 'playing', selected_event_id: finalEventId, current_turn_participant_id: shuffled[0].id }).eq('code', currentRoom.code); 
      } catch (error: any) { Alert.alert('Erro', error.message); } 
  };

  // ==================================================================================
  // 7. FUNÇÕES DE SUPORTE (DELETE / HELPERS)
  // ==================================================================================
  
  const getCategoryColor = (cat?: string) => { switch(cat) { case 'equipe': return '#FFD700'; case 'hit': return '#ff4444'; default: return '#00B37E'; } };

  const handleDeleteChar = async (id: string) => { 
      Alert.alert("Excluir", "Tem certeza?", [ 
          { text: "Cancelar" }, 
          { text: "Excluir", onPress: async () => { await supabase.from('game_characters').delete().eq('id', id); fetchCatalogs(); }}
      ]); 
  };

  // Wrapper para abrir edição usando o novo componente
  const openCreateChar = () => {
      setCharToEdit(null);
      setCharEditorVisible(true);
  };
  
  const openEditChar = (char: any) => {
      setCharToEdit(char);
      setCharEditorVisible(true);
  };

  const handleOpenDetails = async (item: UserRosterItem) => { 
      if (!item.game_characters) return; 
      setSelectedCharacter(item); setLoadingStats(true); setDetailsModalVisible(true); 
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

  const handleToggleChallenge = async (item: UserRosterItem) => { 
      const newValue = !item.challenge_completed; 
      setPlayedCharacters(prev => prev.map(p => p.id === item.id ? { ...p, challenge_completed: newValue } : p)); 
      if (selectedCharacter && selectedCharacter.id === item.id) { setSelectedCharacter({ ...selectedCharacter, challenge_completed: newValue }); } 
      await supabase.from('user_roster').update({ challenge_completed: newValue }).eq('id', item.id); 
  };

  // Lógica de Efeitos (Mantida aqui por enquanto)
  const openCreateEffectModal = () => { setEditingEffectId(null); setEffectTitle(''); setEffectDesc(''); setEffectDamage(''); setEffectDuration(''); setEffectType('buff'); setCreateEffectModalVisible(true); };
  const openEditEffectModal = (eff: StatusEffect) => { setEditingEffectId(eff.id); setEffectTitle(eff.title); setEffectDesc(eff.description); setEffectType(eff.type); setEffectDamage(eff.damage || ''); setEffectDuration(String(eff.duration || '')); setCreateEffectModalVisible(true); };
  const handleSaveEffect = async () => { 
      if(!effectTitle) return Alert.alert("Erro", "Título é obrigatório"); 
      const p = { title: effectTitle, description: effectDesc, type: effectType, damage: effectType === 'debuff' ? effectDamage : null, duration: parseInt(effectDuration) || 0 }; 
      if(editingEffectId) await supabase.from('game_status_effects').update(p).eq('id', editingEffectId); 
      else await supabase.from('game_status_effects').insert(p); 
      setCreateEffectModalVisible(false); fetchCatalogs(); 
  };
  const deleteEffect = async(id:string) => { Alert.alert("Apagar Efeito", "Confirmar?", [{text:"Cancelar"}, {text:"Apagar", onPress:async()=>{await supabase.from('game_status_effects').delete().eq('id',id); fetchCatalogs();}}]); };


  // ==================================================================================
  // 8. RENDERIZAÇÃO
  // ==================================================================================

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
      
      {/* HEADER */}
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
        
        {/* MATCHMAKING */}
        <View style={styles.matchmakingContainer}>
            <Text style={styles.sectionTitle}>Multiplayer</Text>
            <TouchableOpacity style={styles.newGameButton} onPress={() => { handleCreateRoom(); fetchCatalogs(); }}>
                <View style={styles.newGameIcon}><Ionicons name="add" size={32} color="#fff" /></View>
                <View>
                    <Text style={styles.newGameTitle}>CRIAR SALA</Text>
                    <Text style={styles.newGameSubtitle}>Seja o Host da partida</Text>
                </View>
            </TouchableOpacity>
            <View style={styles.joinContainer}>
                <TextInput style={styles.joinInput} placeholder="CÓDIGO" placeholderTextColor="#555" maxLength={4} autoCapitalize="characters" value={joinCode} onChangeText={setJoinCode}/>
                <TouchableOpacity style={styles.joinButton} onPress={() => { handleJoinRoom(); fetchCatalogs(); }}>
                    <Text style={styles.joinButtonText}>ENTRAR</Text>
                </TouchableOpacity>
            </View>
        </View>
        
        {/* AÇÕES DE CRIAÇÃO (AGORA CHAMA COMPONENTES LIMPOS) */}
        <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.createButton, {backgroundColor: '#202024', borderWidth: 1, borderColor: '#8257e5', flex: 1, marginRight: 5}]} onPress={openCreateChar}>
                <Ionicons name="person-add" size={18} color="#8257e5" style={{marginRight: 5}}/>
                <Text style={styles.createButtonText}>Add Char</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.createButton, {backgroundColor: '#202024', borderWidth: 1, borderColor: '#00B37E', flex: 1, marginHorizontal: 5}]} onPress={() => { setEventManagerVisible(true); fetchCatalogs(); }}>
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

      {/* ======================= COMPONENTES MODULARES ======================= */}
      
      {/* EDITOR DE PERSONAGEM */}
      <CharacterEditor 
        visible={charEditorVisible}
        onClose={() => setCharEditorVisible(false)}
        onSuccess={() => {
            fetchData();
            if(lobbyModalVisible) fetchCatalogs();
        }}
        characterToEdit={charToEdit}
      />

      {/* GERENCIADOR DE EVENTOS */}
      <EventManager 
        visible={eventManagerVisible}
        onClose={() => setEventManagerVisible(false)}
      />

      {/* ===================================================================== */}

      {/* LOBBY MODAL (Mantido aqui pois é o "estado de espera" antes do jogo) */}
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
                                  {!!(p.user_id === currentRoom.host_id) && <Text style={{color:'#FFD700', marginLeft:5}}>👑</Text>}
                              </View>
                          ))}
                      </View>
                      
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
                                  <TouchableOpacity style={[styles.actionButton, {marginTop:30, backgroundColor:'#FFD700'}]} onPress={handleStartGame}>
                                      <Text style={[styles.actionButtonText, {color:'#000'}]}>INICIAR PARTIDA</Text>
                                  </TouchableOpacity>
                              )}
                          </View>
                      ) : (
                          <FlatList 
                              data={catalogChars} 
                              keyExtractor={item => item.id} 
                              renderItem={({item}) => (
                                  <View style={styles.catalogItem}>
                                      <TouchableOpacity style={{flex: 1, flexDirection:'row', alignItems:'center'}} onPress={() => handleSelectCharacter(item.id)}>
                                          {item.image_url ? <Image source={{uri: item.image_url}} style={styles.catalogImage} /> : <View style={styles.catalogImage} /> }
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
                                          <TouchableOpacity onPress={() => openEditChar(item)} style={{padding:5}}>
                                              <Ionicons name="pencil" size={20} color="#8257e5" />
                                          </TouchableOpacity>
                                          <TouchableOpacity onPress={() => handleDeleteChar(item.id)} style={{padding:5}}>
                                              <Ionicons name="trash" size={20} color="#ff4444" />
                                          </TouchableOpacity>
                                      </View>
                                  </View>
                              )}
                          />
                      )}
                  </View>
              )}
          </View>
      </Modal>

      {/* MANAGE EFFECTS MODAL (Mantido aqui pois não foi migrado para EventManager ainda) */}
      <Modal transparent visible={manageEffectsModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Buffs & Debuffs</Text><TouchableOpacity onPress={openCreateEffectModal}><Ionicons name="add-circle" size={28} color="#00B37E"/></TouchableOpacity><TouchableOpacity onPress={()=>setManageEffectsModalVisible(false)}><Ionicons name="close" size={24} color="#ccc"/></TouchableOpacity></View><FlatList data={catalogEffects} keyExtractor={i=>i.id} renderItem={({item})=>(<View style={styles.catalogItem}><View style={{flex:1}}><Text style={[styles.catalogName, {color: item.type==='buff'?'#00B37E':'#ff4444'}]}>{item.title}</Text><Text style={styles.catalogOrigin}>{item.type.toUpperCase()}{item.duration ? ` • ${item.duration} Rnds` : ''}</Text></View><TouchableOpacity onPress={()=>openEditEffectModal(item)} style={{marginRight:15}}><Ionicons name="pencil" size={20} color="#8257e5"/></TouchableOpacity><TouchableOpacity onPress={()=>deleteEffect(item.id)}><Ionicons name="trash" size={20} color="red"/></TouchableOpacity></View>)}/></View></View></Modal>
      <Modal transparent visible={createEffectModalVisible} animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>{editingEffectId ? "Editar Efeito" : "Criar Efeito"}</Text><View style={{flexDirection:'row', marginBottom:15}}><TouchableOpacity onPress={()=>setEffectType('buff')} style={[styles.typeBadge, effectType==='buff' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>BUFF (Bom)</Text></TouchableOpacity><TouchableOpacity onPress={()=>setEffectType('debuff')} style={[styles.typeBadge, effectType==='debuff' && {backgroundColor:'#ff4444', borderColor:'#ff4444'}]}><Text style={styles.typeText}>DEBUFF (Ruim)</Text></TouchableOpacity></View><TextInput style={styles.input} placeholder="Título (Ex: Veneno)" placeholderTextColor="#555" value={effectTitle} onChangeText={setEffectTitle}/><TextInput style={styles.input} placeholder="Descrição" placeholderTextColor="#555" value={effectDesc} onChangeText={setEffectDesc}/><TextInput style={styles.input} placeholder="Duração" placeholderTextColor="#555" value={effectDuration} onChangeText={setEffectDuration} keyboardType="numeric"/>{effectType === 'debuff' && (<TextInput style={[styles.input, {borderColor:'#ff4444'}]} placeholder="Dano (Ex: 10)" placeholderTextColor="#555" value={effectDamage} onChangeText={setEffectDamage}/>)}<TouchableOpacity onPress={handleSaveEffect} style={styles.saveButton}><Text style={styles.saveButtonText}>SALVAR</Text></TouchableOpacity><TouchableOpacity onPress={()=>setCreateEffectModalVisible(false)} style={[styles.saveButton,{backgroundColor:'#333', marginTop:10}]}><Text style={styles.saveButtonText}>Cancelar</Text></TouchableOpacity></View></View></Modal>

      {/* DETAILS MODAL */}
      <Modal animationType="fade" transparent={true} visible={detailsModalVisible} onRequestClose={() => setDetailsModalVisible(false)}><View style={styles.modalOverlay}><View style={[styles.modalContent, { height: '65%' }]}>{selectedCharacter ? (<View style={{alignItems: 'center'}}>{selectedCharacter.game_characters?.image_url ? <Image source={{uri: selectedCharacter.game_characters.image_url}} style={styles.detailsImageBig} /> : <View style={styles.detailsIconBig}><Text style={{fontSize: 40}}>👤</Text></View>}<Text style={styles.detailsTitle}>{selectedCharacter.game_characters?.name || 'Desconhecido'}</Text><Text style={styles.detailsClass}>{selectedCharacter.game_characters?.base_class}</Text><Text style={[styles.detailsClass, {color: getCategoryColor(selectedCharacter.game_characters?.category), marginTop:5}]}>{selectedCharacter.game_characters?.category?.toUpperCase() || 'INDIVIDUAL'}</Text><View style={styles.levelBigBadge}><Text style={styles.levelLabel}>HP BASE: {selectedCharacter.game_characters?.base_hp}</Text>{(selectedCharacter.game_characters?.base_shield || 0) > 0 && <Text style={[styles.levelLabel, {color:'#44aaff', marginTop:5}]}>ESCUDO: {selectedCharacter.game_characters?.base_shield}</Text>}</View><View style={styles.statsRow}><View style={styles.statBox}><Ionicons name="trophy" size={24} color="#FFD700" /><Text style={styles.statValue}>{selectedCharStats.wins}</Text><Text style={styles.statLabel}>Vitórias (Lv)</Text></View><View style={styles.statBox}><Ionicons name="game-controller" size={24} color="#ccc" /><Text style={styles.statValue}>{selectedCharStats.matches}</Text><Text style={styles.statLabel}>Partidas</Text></View><View style={styles.statBox}><Ionicons name="pie-chart" size={24} color="#8257e5" /><Text style={styles.statValue}>{selectedCharStats.winRate}%</Text><Text style={styles.statLabel}>Taxa</Text></View></View><View style={{flexDirection:'row', alignItems:'center', marginTop:20, backgroundColor:'#222', padding:10, borderRadius:8, width:'100%'}}><Text style={{color:'#fff', flex:1, fontSize:14, marginRight:10}}>Desafio do Personagem Concluído?</Text><TouchableOpacity onPress={() => handleToggleChallenge(selectedCharacter)} style={{width:24, height:24, borderRadius:4, borderWidth:1, borderColor:'#555', alignItems:'center', justifyContent:'center', backgroundColor: selectedCharacter.challenge_completed ? '#00B37E' : 'transparent'}}>{!!selectedCharacter.challenge_completed && <Ionicons name="checkmark" size={18} color="#fff" />}</TouchableOpacity></View>{!!loadingStats && <ActivityIndicator size="small" color="#8257e5" style={{marginTop:10}}/>}<TouchableOpacity style={styles.closeButton} onPress={() => setDetailsModalVisible(false)}><Text style={styles.closeButtonText}>Fechar</Text></TouchableOpacity></View>) : <ActivityIndicator size="large" color="#8257e5"/>}</View></View></Modal>

    </View>
  );
}

// ==================================================================================
// 9. STYLES
// ==================================================================================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121214', paddingTop: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, paddingHorizontal: 20 },
  greeting: { color: '#E1E1E6', fontSize: 20, fontWeight: 'bold' },
  userEmail: { color: '#7C7C8A', fontSize: 12 },
  logoutButton: { padding: 8, backgroundColor: '#202024', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 }, 
  matchmakingContainer: { backgroundColor: '#202024', padding: 20, borderRadius: 12, marginBottom: 25 },
  
  newGameButton: { backgroundColor: '#8257e5', borderRadius: 8, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  newGameIcon: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 10, borderRadius: 50, marginRight: 15 },
  newGameTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  newGameSubtitle: { color: '#E0D1FF', fontSize: 12 },
  
  joinContainer: { flexDirection: 'row' },
  joinInput: { flex: 1, backgroundColor: '#121214', color: '#fff', borderRadius: 8, paddingHorizontal: 15, marginRight: 10, borderWidth: 1, borderColor: '#333', textAlign: 'center', fontSize: 18, fontWeight: 'bold' },
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
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 20 },
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
  closeButton: { backgroundColor: '#333', padding: 15, borderRadius: 8, marginTop: 20, width: '100%', alignItems: 'center' },
  closeButtonText: { color: '#fff' },
  
  statsRow: { flexDirection:'row', justifyContent:'space-around', width:'100%', marginTop:25 },
  statBox: { alignItems:'center', backgroundColor:'#222', padding:10, borderRadius:8, width:'30%' },
  statValue: { color:'#fff', fontWeight:'bold', fontSize:18, marginTop:5 },
  statLabel: { color:'#777', fontSize:10 },

  typeBadge: { borderWidth:1, borderColor:'#555', padding:8, borderRadius:20, flex:1, marginHorizontal:2, alignItems:'center' },
  typeText: { color:'#fff', fontSize:10, fontWeight:'bold' },
});