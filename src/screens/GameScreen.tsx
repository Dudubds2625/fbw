// src/screens/GameScreen.tsx
import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, 
  Alert, Image, ActivityIndicator, Modal, FlatList 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { Room, RoomParticipant, GameCharacter, GameEvent, CharacterSkill, ActiveTransformation, StatusEffect, ActiveStatusEffect, TeamMember, TeamMemberState } from '../types/rpg';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeChannel } from '@supabase/supabase-js';

interface GameScreenProps {
  roomCode: string;
  userId: string;
  onExitGame: () => void;
}

export default function GameScreen({ roomCode, userId, onExitGame }: GameScreenProps) {
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [myParticipant, setMyParticipant] = useState<RoomParticipant | null>(null);
  const [charactersMap, setCharactersMap] = useState<Record<string, GameCharacter>>({});
  
  const [mySkills, setMySkills] = useState<CharacterSkill[]>([]);
  const [catalogEffects, setCatalogEffects] = useState<StatusEffect[]>([]); 
  
  // MODAIS
  const [skillsModalVisible, setSkillsModalVisible] = useState(false);
  const [effectsListModalVisible, setEffectsListModalVisible] = useState(false);
  const [targetEffectType, setTargetEffectType] = useState<'buff' | 'debuff'>('buff');
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [deployMemberModalVisible, setDeployMemberModalVisible] = useState(false); 

  const [gameEvent, setGameEvent] = useState<GameEvent | null>(null);
  
  // REFS & CONTROLES
  const currentEventIdRef = useRef<string | null>(null);
  const hasShownEventRef = useRef(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const prevTurnIdRef = useRef<string | null>(null);

  // ESTADOS LOCAIS (HP Geral)
  const [hp, setHp] = useState(10);
  const [maxHp, setMaxHp] = useState(10);
  const [buffs, setBuffs] = useState('');
  const [debuffs, setDebuffs] = useState('');
  
  const [processingPhase, setProcessingPhase] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  useEffect(() => {
    fetchGameData();
    subscribeToGame();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, []);

  // --- LÓGICA: ABRE MODAL AUTOMATICAMENTE SE EQUIPE ESTIVER VAZIA ---
  useEffect(() => {
    if (myParticipant && Object.keys(charactersMap).length > 0 && !initialCheckDone) {
        const myChar = myParticipant.selected_character_id ? charactersMap[myParticipant.selected_character_id] : null;
        
        // Se for equipe E não tiver ninguém no array team_state
        if (myChar?.category === 'equipe') {
            const activeUnits = myParticipant.team_state || [];
            if (activeUnits.length === 0) {
                setDeployMemberModalVisible(true);
            }
        }
        setInitialCheckDone(true); 
    }
  }, [myParticipant, charactersMap, initialCheckDone]);

  const fetchGameData = async () => {
    try {
        const { data: roomData, error: roomError } = await supabase.from('rooms').select('*').eq('code', roomCode).maybeSingle(); 
        if (roomError) throw roomError;
        if (!roomData) { Alert.alert("Erro", "Sala não encontrada."); onExitGame(); return; }
        setRoom(roomData);
        
        if (roomData.current_turn_participant_id) checkTurnChange(roomData.current_turn_participant_id);

        if (roomData.selected_event_id && roomData.selected_event_id !== currentEventIdRef.current) {
            const { data: ev } = await supabase.from('game_events').select('*').eq('id', roomData.selected_event_id).maybeSingle();
            if (ev) {
                setGameEvent(ev);
                currentEventIdRef.current = ev.id;
                hasShownEventRef.current = false;
            }
            if (!hasShownEventRef.current) { setEventModalVisible(true); hasShownEventRef.current = true; }
        }

        if (catalogEffects.length === 0) {
            const { data: effs } = await supabase.from('game_status_effects').select('*').order('title');
            if (effs) setCatalogEffects(effs);
        }

        const { data: parts } = await supabase.from('room_participants').select('*').eq('room_code', roomCode).order('turn_order', { ascending: true });
        if (parts) {
            setParticipants(parts);
            const me = parts.find(p => p.user_id === userId);
            if (me) {
                setMyParticipant(me);
                
                // Sincroniza HP Global
                if (me.max_hp !== maxHp) setMaxHp(me.max_hp);
                if (me.current_hp !== hp && !processingPhase) setHp(me.current_hp);
                
                if (me.buffs !== buffs) setBuffs(me.buffs || '');
                if (me.debuffs !== debuffs) setDebuffs(me.debuffs || '');

                if (me.selected_character_id && mySkills.length === 0) {
                    const { data: skills } = await supabase.from('character_skills').select('*').eq('character_id', me.selected_character_id);
                    if (skills) setMySkills(skills);
                }
            }
            
            const charIds = parts.map(p => p.selected_character_id).filter(id => id) as string[];
            if (charIds.length > 0) {
                const { data: chars } = await supabase.from('game_characters').select('*').in('id', charIds);
                const map: Record<string, GameCharacter> = {};
                chars?.forEach(c => map[c.id] = c);
                setCharactersMap(map);
            }
        }
    } catch (error: any) { console.log("Erro fetchGameData:", error); }
  };

  const subscribeToGame = () => {
    const channel = supabase.channel(`game_${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` }, 
        payload => {
            const newRoom = payload.new as Room;
            setRoom(newRoom);
            if (newRoom.current_turn_participant_id) checkTurnChange(newRoom.current_turn_participant_id);
            if (newRoom.selected_event_id && newRoom.selected_event_id !== currentEventIdRef.current) fetchGameData(); 
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_code=eq.${roomCode}` }, () => fetchGameData())
      .subscribe();
    channelRef.current = channel;
  };

  // --- LÓGICA DE FASES ---
  const handlePhaseAction = async () => {
    if (!room || !participants.length || !room.current_turn_participant_id) return;
    if (myParticipant && room.current_turn_participant_id !== myParticipant.id) return;
    
    setProcessingPhase(true);

    try {
        const currentPhase = room.turn_phase || 'initial';

        if (currentPhase === 'initial') {
            await supabase.from('rooms').update({ turn_phase: 'main' }).eq('code', roomCode);
        } else if (currentPhase === 'main') {
            await processEndTurnLogic(); 
            await supabase.from('rooms').update({ turn_phase: 'end' }).eq('code', roomCode);
        } else {
            const currentIndex = participants.findIndex(p => p.id === room.current_turn_participant_id);
            const nextIndex = (currentIndex + 1) % participants.length;
            await supabase.from('rooms').update({ 
                current_turn_participant_id: participants[nextIndex].id,
                turn_phase: 'initial' 
            }).eq('code', roomCode);
        }
    } catch (error) {
        Alert.alert("Erro", "Falha ao mudar de fase.");
    } finally {
        setProcessingPhase(false);
    }
  };

  const processEndTurnLogic = async () => {
      if (!myParticipant) return;

      // 1. Transformações
      let updatedTrans = [...(myParticipant.active_transformations || [])];
      let transExpired: string[] = [];
      updatedTrans = updatedTrans.map(t => ({ ...t, rounds_left: t.rounds_left - 1 })).filter(t => {
          if (t.rounds_left <= 0) { transExpired.push(t.name); return false; }
          return true;
      });

      // 2. Buffs
      let updatedBuffs = [...(myParticipant.active_buffs || [])];
      let buffsExpired: string[] = [];
      updatedBuffs = updatedBuffs.map(b => ({ ...b, duration: b.duration - 1 })).filter(b => {
          if (b.duration <= 0) { buffsExpired.push(b.name); return false; }
          return true;
      });

      // 3. Debuffs
      let updatedDebuffs = [...(myParticipant.active_debuffs || [])];
      let debuffsExpired: string[] = [];
      let totalDamageTaken = 0;
      let damageSources: string[] = [];

      updatedDebuffs = updatedDebuffs.map(d => {
          if (d.damage) {
              const dmgVal = parseInt(d.damage);
              if (!isNaN(dmgVal) && dmgVal > 0) {
                  let finalDmg = dmgVal;
                  const myChar = myParticipant.selected_character_id ? charactersMap[myParticipant.selected_character_id] : null;
                  if (myChar?.category === 'hit') finalDmg = 1; 
                  
                  totalDamageTaken += finalDmg;
                  damageSources.push(`${d.name} (${finalDmg})`);
              }
          }
          return { ...d, duration: d.duration - 1 };
      }).filter(d => {
          if (d.duration <= 0) { debuffsExpired.push(d.name); return false; }
          return true;
      });

      const finalHp = Math.max(0, hp - totalDamageTaken);
      if (finalHp !== hp) setHp(finalHp);

      await supabase.from('room_participants').update({
          active_transformations: updatedTrans,
          active_buffs: updatedBuffs,
          active_debuffs: updatedDebuffs,
          current_hp: finalHp
      }).eq('id', myParticipant.id);

      let alertMsg = "";
      if (totalDamageTaken > 0) alertMsg += `💥 Dano recebido: ${damageSources.join(', ')}.\n`;
      if (transExpired.length > 0) alertMsg += `❌ Transformações acabaram: ${transExpired.join(', ')}.\n`;
      if (buffsExpired.length > 0 || debuffsExpired.length > 0) alertMsg += `⌛ Efeitos expiraram: ${[...buffsExpired, ...debuffsExpired].join(', ')}.`;

      if (alertMsg) Alert.alert("Fim da Main Phase", alertMsg);
  };

  const checkTurnChange = async (currentTurnParticipantId: string) => {
      const myId = participants.find(p => p.user_id === userId)?.id;
      if (myId && prevTurnIdRef.current && prevTurnIdRef.current !== myId && currentTurnParticipantId === myId) {
          console.log("⚡ É MEU TURNO!");
      }
      prevTurnIdRef.current = currentTurnParticipantId;
  };

  // --- LÓGICA DE DANO (INDIVIDUAL / HIT) ---
  const updateGlobalStats = async (newHp: number, newMax: number) => {
    if (!myParticipant) return;
    await supabase.from('room_participants').update({ current_hp: newHp, max_hp: newMax }).eq('id', myParticipant.id);
  };

  const changeHp = (amount: number) => { 
      let finalAmount = amount;
      const myChar = myParticipant?.selected_character_id ? charactersMap[myParticipant.selected_character_id] : null;
      if (myChar?.category === 'hit' && amount < 0) finalAmount = -1;
      const newVal = Math.max(0, Math.min(maxHp, hp + finalAmount)); 
      setHp(newVal); 
      updateGlobalStats(newVal, maxHp); 
  };

  const changeMaxHp = (amount: number) => { 
      const newVal = Math.max(1, maxHp + amount); 
      setMaxHp(newVal); 
      const fixedHp = Math.min(hp, newVal); 
      if (fixedHp !== hp) setHp(fixedHp); 
      updateGlobalStats(fixedHp, newVal); 
  };

  // --- LÓGICA DE EQUIPE (MÚLTIPLOS ATIVOS) ---
  
  // 1. ADICIONAR UM NOVO MEMBRO AO CAMPO
  const handleAddMemberToField = async (member: TeamMember) => {
      if (!myParticipant) return;
      
      const currentState = [...(myParticipant.team_state || [])];
      
      // Adiciona nova instância do membro ao array
      const newUnit: TeamMemberState = {
          name: member.name,
          current_hp: member.base_hp,
          max_hp: member.base_hp
      };
      
      const newState = [...currentState, newUnit];
      
      // Calcula HP total para mostrar na lista de participantes
      const totalHp = newState.reduce((acc, u) => acc + u.current_hp, 0);
      const totalMaxHp = newState.reduce((acc, u) => acc + u.max_hp, 0);

      await supabase.from('room_participants').update({
          team_state: newState,
          current_hp: totalHp,
          max_hp: totalMaxHp
      }).eq('id', myParticipant.id);

      setDeployMemberModalVisible(false);
  };

  // 2. ALTERAR HP DE UMA UNIDADE ESPECÍFICA
  const changeUnitHp = async (index: number, amount: number) => {
      if (!myParticipant || !myParticipant.team_state) return;

      const newState = [...myParticipant.team_state];
      const unit = { ...newState[index] }; 

      unit.current_hp = Math.min(unit.max_hp, unit.current_hp + amount);

      // SE VIDA ZERAR -> REMOVE DO ARRAY
      if (unit.current_hp <= 0) {
          newState.splice(index, 1); // Remove da lista
      } else {
          newState[index] = unit; 
      }

      // Recalcula totais globais
      const totalHp = newState.reduce((acc, u) => acc + u.current_hp, 0);
      const totalMaxHp = newState.reduce((acc, u) => acc + u.max_hp, 0); 

      await supabase.from('room_participants').update({
          team_state: newState,
          current_hp: totalHp,
          max_hp: totalMaxHp
      }).eq('id', myParticipant.id);
  };

  // --- CORREÇÃO DO HANDLE LEAVE ROOM ---
  const handleLeaveRoom = async () => {
    // 1. Remove listener do Realtime
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    
    // 2. Remove o participante do banco de dados (se quiser que ele suma da sala)
    // Se preferir apenas sair localmente, remova a linha abaixo.
    await supabase.from('room_participants').delete().eq('room_code', roomCode).eq('user_id', userId);
    
    // 3. Chama a prop para voltar a tela anterior
    onExitGame();
  };

  // --- FUNÇÕES AUXILIARES DE MODAIS E EFEITOS (MANTIDAS IGUAIS) ---
  const removeStatusEffect = async (effectName: string, type: 'buff' | 'debuff') => { if (!myParticipant) return; if (type === 'buff') { const newArr = (myParticipant.active_buffs || []).filter(e => e.name !== effectName); await supabase.from('room_participants').update({ active_buffs: newArr }).eq('id', myParticipant.id); } else { const newArr = (myParticipant.active_debuffs || []).filter(e => e.name !== effectName); await supabase.from('room_participants').update({ active_debuffs: newArr }).eq('id', myParticipant.id); } };
  const activateSkill = async (skill: CharacterSkill) => { if (skill.type === 'transformation') { const currentList = myParticipant?.active_transformations || []; if (currentList.some(t => t.name === skill.name)) { Alert.alert("Já ativo", `${skill.name} já está ativa.`); return; } const baseDuration = (skill.duration && skill.duration > 0) ? skill.duration : 3; const durationWithBuffer = baseDuration + 1; const newList = [...currentList, { name: skill.name, rounds_left: durationWithBuffer }]; await supabase.from('room_participants').update({ active_transformations: newList }).eq('id', myParticipant?.id); Alert.alert("Transformação!", `${skill.name} ativada por ${baseDuration} rodadas.`); } else { const newBuffs = buffs ? `${buffs}, ${skill.name}` : skill.name; setBuffs(newBuffs); await supabase.from('room_participants').update({ buffs: newBuffs }).eq('id', myParticipant?.id); Alert.alert("Habilidade", `${skill.name} usada!`); } setSkillsModalVisible(false); };
  const openEffectList = (type: 'buff' | 'debuff') => { setTargetEffectType(type); setEffectsListModalVisible(true); };
  const applyStatusEffect = async (effect: StatusEffect) => { if (!myParticipant) return; const baseDuration = (effect.duration && effect.duration > 0) ? effect.duration : 0; const finalDuration = targetEffectType === 'buff' ? (baseDuration > 0 ? baseDuration + 1 : 0) : baseDuration; const newEffect: ActiveStatusEffect = { name: effect.title, description: effect.description, damage: effect.damage, duration: finalDuration }; if (targetEffectType === 'buff') { const currentBuffs = myParticipant.active_buffs || []; if (currentBuffs.some(b => b.name === newEffect.name)) { Alert.alert("Repetido", "Já possui esse buff."); return; } await supabase.from('room_participants').update({ active_buffs: [...currentBuffs, newEffect] }).eq('id', myParticipant.id); } else { const currentDebuffs = myParticipant.active_debuffs || []; if (currentDebuffs.some(d => d.name === newEffect.name)) { Alert.alert("Repetido", "Já possui esse debuff."); return; } await supabase.from('room_participants').update({ active_debuffs: [...currentDebuffs, newEffect] }).eq('id', myParticipant.id); } setEffectsListModalVisible(false); };
  const getVisualDuration = (dur: number, type: 'buff' | 'debuff' | 'trans') => { if (dur <= 0) return '∞'; if (type === 'debuff') return `${dur}`; return `${Math.max(dur - 1, 0)}`; };
  const getPhaseLabel = (phase?: string) => { switch(phase) { case 'main': return "MAIN PHASE"; case 'end': return "END PHASE"; default: return "INITIAL PHASE"; } };
  const getButtonLabel = (phase?: string) => { switch(phase) { case 'initial': return "IR PARA MAIN PHASE 🛡️"; case 'main': return "IR PARA END PHASE 🏁"; case 'end': return "ENCERRAR TURNO ⏭️"; default: return "INICIAR"; } };
  const getPhaseColor = (phase?: string) => { switch(phase) { case 'main': return "#00B37E"; case 'end': return "#FFD700"; default: return "#8257e5"; } };

  if (!myParticipant || !room) return <View style={styles.loading}><ActivityIndicator size="large" color="#8257e5" /><Text style={{color:'#fff'}}>Carregando...</Text><TouchableOpacity onPress={onExitGame} style={{marginTop:20, padding:10, backgroundColor:'#333', borderRadius:8}}><Text style={{color:'#fff'}}>Sair</Text></TouchableOpacity></View>;

  const isMyTurn = room.current_turn_participant_id === myParticipant.id;
  const currentPhase = room.turn_phase || 'initial';
  const myChar = myParticipant.selected_character_id ? charactersMap[myParticipant.selected_character_id] : null;
  const currentPlayer = participants.find(p => p.id === room.current_turn_participant_id);
  
  const transformations = mySkills.filter(s => s.type === 'transformation');
  const activeSkills = mySkills.filter(s => s.type === 'active');
  const passives = mySkills.filter(s => s.type === 'passive');
  const filteredEffects = catalogEffects.filter(e => e.type === targetEffectType);
  
  // A lista de invocação vem dos dados ORIGINAIS do personagem (catalogo)
  const reserveMembers = myChar?.team_members || [];
  // A lista ativa vem do STATE da sala
  const activeUnits = myParticipant.team_state || [];

  return (
    <View style={styles.container}>
      <View style={[styles.turnHeader, isMyTurn ? styles.myTurnHeader : {}]}>
        <View style={{flex: 1}}>
            <Text style={styles.turnText}>{isMyTurn ? "🔥 SUA VEZ!" : `Vez de: ${currentPlayer?.username || '...'}`}</Text>
            <View style={{flexDirection:'row', alignItems:'center', marginTop: 5}}>
                <View style={[styles.phaseDot, currentPhase === 'initial' && {backgroundColor: '#8257e5'}]} />
                <View style={[styles.phaseLine, (currentPhase === 'main' || currentPhase === 'end') && {backgroundColor: '#00B37E'}]} />
                <View style={[styles.phaseDot, currentPhase === 'main' && {backgroundColor: '#00B37E'}]} />
                <View style={[styles.phaseLine, currentPhase === 'end' && {backgroundColor: '#FFD700'}]} />
                <View style={[styles.phaseDot, currentPhase === 'end' && {backgroundColor: '#FFD700'}]} />
                <Text style={[styles.phaseText, {color: getPhaseColor(currentPhase)}]}>{getPhaseLabel(currentPhase)}</Text>
            </View>
        </View>
        <TouchableOpacity style={styles.missionBtn} onPress={() => setEventModalVisible(true)}><Ionicons name="map" color="#fff" size={16} /><Text style={styles.missionBtnText}> Missão</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.charArea}>
            {myChar?.image_url ? <Image source={{ uri: myChar.image_url }} style={styles.charImage} /> : <View style={styles.charPlaceholder}><Ionicons name="person" size={40} color="#fff" /></View>}
            <View>
                <Text style={styles.charName}>{myChar?.name || 'Unknown'}</Text>
                <View style={{flexDirection:'row'}}>
                    <Text style={styles.playerNameTag}>({myParticipant.username})</Text>
                    {myChar?.category && <Text style={[styles.playerNameTag, {marginLeft:5, color:'#FFD700', fontWeight:'bold'}]}>[{myChar.category.toUpperCase()}]</Text>}
                </View>
            </View>
        </View>

        {/* --- CONTROLE DE VIDA: CONDICIONAL --- */}
        {myChar?.category === 'equipe' ? (
            <View style={styles.teamContainer}>
                <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                    <Text style={styles.label}>UNIDADES ATIVAS</Text>
                    <TouchableOpacity onPress={() => setDeployMemberModalVisible(true)} style={styles.addMemberBtn}>
                        <Ionicons name="add" size={16} color="#000" />
                        <Text style={styles.addMemberText}> Invocar</Text>
                    </TouchableOpacity>
                </View>

                {activeUnits.length === 0 ? (
                    <Text style={{color:'#555', fontStyle:'italic', textAlign:'center', marginVertical:10}}>Nenhuma unidade em campo.</Text>
                ) : (
                    activeUnits.map((unit, idx) => (
                        <View key={`${unit.name}-${idx}`} style={styles.unitRow}>
                            <Text style={styles.unitName}>{unit.name}</Text>
                            <View style={styles.unitControls}>
                                <TouchableOpacity onPress={() => changeUnitHp(idx, -1)} style={[styles.miniBtn, {backgroundColor:'#ff4444'}]}>
                                    <Ionicons name="remove" size={16} color="#fff"/>
                                </TouchableOpacity>
                                <Text style={styles.unitHp}>{unit.current_hp}</Text>
                                <TouchableOpacity onPress={() => changeUnitHp(idx, 1)} style={[styles.miniBtn, {backgroundColor:'#00B37E'}]}>
                                    <Ionicons name="add" size={16} color="#fff"/>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))
                )}
                
                <Text style={{color:'#777', fontSize:10, textAlign:'center', marginTop:5}}>HP TOTAL DO EXÉRCITO: {hp}</Text>
            </View>
        ) : (
            // --- CONTROLE PADRÃO (Individual / Hit) ---
            <View style={styles.statsCard}>
                <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}>
                    <Text style={styles.label}>{myChar?.category === 'hit' ? "HITS (VIDA FIXA)" : "HP"}</Text>
                    <View style={{flexDirection:'row', alignItems:'center'}}>
                        <Text style={[styles.label, {color:'#777', marginRight:5}]}>Max:</Text>
                        <TouchableOpacity onPress={() => changeMaxHp(-1)}><Ionicons name="remove-circle" color="#555" size={24}/></TouchableOpacity>
                        <Text style={{color:'#fff', fontWeight:'bold', marginHorizontal:5, fontSize:16}}>{maxHp}</Text>
                        <TouchableOpacity onPress={() => changeMaxHp(1)}><Ionicons name="add-circle" color="#555" size={24}/></TouchableOpacity>
                    </View>
                </View>
                <View style={styles.hpControls}><TouchableOpacity onPress={() => changeHp(-1)} style={[styles.hpBtn, {backgroundColor: '#ff4444'}]}><Ionicons name="remove" size={32} color="#fff" /></TouchableOpacity><View style={styles.hpDisplay}><Text style={styles.hpValue}>{hp}</Text></View><TouchableOpacity onPress={() => changeHp(1)} style={[styles.hpBtn, {backgroundColor: '#00B37E'}]}><Ionicons name="add" size={32} color="#fff" /></TouchableOpacity></View>
            </View>
        )}

        {/* BUFFS / DEBUFFS MANTIDOS */}
        {myParticipant.active_transformations && myParticipant.active_transformations.length > 0 && (<View style={{marginBottom: 10}}><Text style={[styles.label, {color:'#FFD700', marginBottom:5}]}>TRANSFORMAÇÕES:</Text><View style={{flexDirection:'row', flexWrap:'wrap'}}>{myParticipant.active_transformations.map((t, idx) => (<View key={`t-${idx}`} style={styles.activeTransBadge}><Text style={styles.activeTransText}>{t.name} ({getVisualDuration(t.rounds_left, 'trans')} rnds)</Text></View>))}</View></View>)}
        <View style={[styles.statsCard, {marginBottom:10}]}><View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5}}><Text style={[styles.label, {color:'#00B37E', marginBottom:0}]}>BUFFS</Text><TouchableOpacity onPress={() => openEffectList('buff')}><Ionicons name="add-circle" size={24} color="#00B37E" /></TouchableOpacity></View><View style={{flexDirection:'row', flexWrap:'wrap', minHeight: 30}}>{(!myParticipant.active_buffs?.length && !buffs) ? <Text style={{color:'#555', fontStyle:'italic', fontSize:12, marginTop:5}}>Nenhum buff.</Text> : null}{myParticipant.active_buffs?.map((b, idx) => (<TouchableOpacity key={`ab-${idx}`} style={[styles.activeTransBadge, {borderColor:'#00B37E', backgroundColor:'rgba(0, 179, 126, 0.1)', flexDirection:'row', alignItems:'center'}]} onPress={() => removeStatusEffect(b.name, 'buff')}><Text style={[styles.activeTransText, {color:'#00B37E', marginRight:5}]}>{b.name} ({getVisualDuration(b.duration, 'buff')})</Text><Ionicons name="close" size={12} color="#00B37E" /></TouchableOpacity>))}</View></View>
        <View style={[styles.statsCard, {marginBottom:10}]}><View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5}}><Text style={[styles.label, {color:'#ff4444', marginBottom:0}]}>DEBUFFS</Text><TouchableOpacity onPress={() => openEffectList('debuff')}><Ionicons name="add-circle" size={24} color="#ff4444" /></TouchableOpacity></View><View style={{flexDirection:'row', flexWrap:'wrap', minHeight: 30}}>{(!myParticipant.active_debuffs?.length && !debuffs) ? <Text style={{color:'#555', fontStyle:'italic', fontSize:12, marginTop:5}}>Nenhum debuff.</Text> : null}{myParticipant.active_debuffs?.map((d, idx) => (<TouchableOpacity key={`ad-${idx}`} style={[styles.activeTransBadge, {borderColor:'#ff4444', backgroundColor:'rgba(255, 68, 68, 0.1)', flexDirection:'row', alignItems:'center'}]} onPress={() => removeStatusEffect(d.name, 'debuff')}><Text style={[styles.activeTransText, {color:'#ff4444', marginRight:5}]}>{d.name} {d.damage ? `[${d.damage}]` : ''} ({getVisualDuration(d.duration, 'debuff')})</Text><Ionicons name="close" size={12} color="#ff4444" /></TouchableOpacity>))}</View></View>

        <TouchableOpacity style={styles.skillsButton} onPress={() => setSkillsModalVisible(true)}><Ionicons name="flash" size={20} color="#FFD700" style={{marginRight:10}} /><Text style={styles.skillsButtonText}>HABILIDADES & TRANSFORMAÇÕES</Text></TouchableOpacity>

        <Text style={styles.sectionTitle}>Grupo</Text>
        {participants.map(p => {
           const pChar = p.selected_character_id ? charactersMap[p.selected_character_id] : null;
           const isCurrent = room.current_turn_participant_id === p.id;
           return (
               <View key={p.id} style={[styles.participantRow, isCurrent ? styles.activeRow : {}]}>
                   <View style={{flex: 1}}>
                       <View style={{flexDirection:'row', alignItems:'center'}}>
                           {isCurrent && <Ionicons name="caret-forward" color="#FFD700" size={16} style={{marginRight: 5}} />}
                           <Text style={[styles.pName, isCurrent ? {color:'#FFD700', fontWeight:'bold'} : {}]}>{p.username}</Text>
                       </View>
                       {/* Se for equipe, mostra quantas unidades vivas */}
                       {pChar?.category === 'equipe' ? (
                           <Text style={styles.pSubName}>{pChar?.name} ({p.team_state?.length || 0} unidades)</Text>
                       ) : (
                           <Text style={styles.pSubName}>{pChar?.name}</Text>
                       )}
                       
                       <View style={{flexDirection:'row', flexWrap:'wrap', marginTop:2}}>
                           {p.active_transformations?.map((t, idx) => (<Text key={`t-${idx}`} style={{color:'#FFD700', fontSize:10, marginRight:5}}>★ {t.name}</Text>))}
                           {p.active_buffs?.map((b, idx) => (<Text key={`b-${idx}`} style={{color:'#00B37E', fontSize:10, marginRight:5}}>↑ {b.name}</Text>))}
                           {p.active_debuffs?.map((d, idx) => (<Text key={`d-${idx}`} style={{color:'#ff4444', fontSize:10, marginRight:5}}>↓ {d.name}</Text>))}
                       </View>
                   </View>
                   <View style={{flexDirection:'row', alignItems:'center'}}>
                       {(p.active_debuffs && p.active_debuffs.length > 0) && <Ionicons name="skull" color="#ff4444" size={16} style={{marginRight: 10}} />}
                       <Text style={[styles.pHp, p.current_hp === 0 ? {color:'#ff4444'} : {}]}>{p.current_hp}/{p.max_hp}</Text>
                   </View>
               </View>
           )
        })}
      </ScrollView>

      {/* FOOTER */}
      <View style={styles.footer}>
        {isMyTurn ? (
            <TouchableOpacity style={[styles.passTurnButton, {backgroundColor: getPhaseColor(currentPhase)}]} onPress={handlePhaseAction} disabled={processingPhase}>
                {processingPhase ? <ActivityIndicator color="#000" /> : <Text style={styles.passTurnText}>{getButtonLabel(currentPhase)}</Text>}
            </TouchableOpacity>
        ) : (
            <View style={styles.waitingBox}><ActivityIndicator size="small" color="#aaa" style={{marginRight: 10}}/><Text style={styles.waitingText}>Aguardando {currentPlayer?.username} ({getPhaseLabel(room.turn_phase)})</Text></View>
        )} 
        <TouchableOpacity style={styles.exitButton} onPress={handleLeaveRoom}><Text style={{color:'#777'}}>Sair</Text></TouchableOpacity>
      </View>

      {/* MODAL INVOCAR MEMBRO */}
      <Modal animationType="fade" transparent={true} visible={deployMemberModalVisible} onRequestClose={() => { if ((myParticipant?.team_state?.length || 0) > 0) setDeployMemberModalVisible(false) }}>
        <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, {maxHeight: '60%'}]}>
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>
                        {(myParticipant?.team_state?.length || 0) === 0 ? "Selecione o Líder" : "Invocar Reforço"}
                    </Text>
                    {/* Só mostra botão de fechar se já tiver alguém em campo */}
                    {(myParticipant?.team_state?.length || 0) > 0 && (
                        <TouchableOpacity onPress={() => setDeployMemberModalVisible(false)}><Ionicons name="close" size={24} color="#ccc" /></TouchableOpacity>
                    )}
                </View>
                
                {reserveMembers.length === 0 ? (
                    <Text style={{color:'#777', textAlign:'center', marginVertical:20}}>Sem reserva.</Text>
                ) : (
                    <FlatList 
                        data={reserveMembers}
                        keyExtractor={(item, index) => `${item.name}-${index}`}
                        renderItem={({item}) => (
                            <TouchableOpacity style={styles.skillItem} onPress={() => handleAddMemberToField(item)}>
                                <View style={{flexDirection:'row', justifyContent:'space-between', flex:1, alignItems:'center'}}>
                                    <Text style={styles.skillName}>{item.name}</Text>
                                    <View style={{backgroundColor:'#00B37E', paddingHorizontal:8, paddingVertical:4, borderRadius:4}}>
                                        <Text style={{color:'#000', fontWeight:'bold'}}>{item.base_hp} HP</Text>
                                    </View>
                                </View>
                            </TouchableOpacity>
                        )}
                    />
                )}
            </View>
        </View>
      </Modal>

      {/* OUTROS MODAIS MANTIDOS */}
      <Modal animationType="slide" transparent={true} visible={skillsModalVisible} onRequestClose={() => setSkillsModalVisible(false)}><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>⚡ Habilidades</Text><TouchableOpacity onPress={() => setSkillsModalVisible(false)}><Ionicons name="close" size={24} color="#ccc" /></TouchableOpacity></View><ScrollView>{mySkills.length === 0 && <Text style={{color:'#777', textAlign:'center', marginTop: 20}}>Nenhuma habilidade cadastrada.</Text>}{transformations.length > 0 && (<View style={styles.skillSection}><Text style={[styles.skillHeader, {color:'#FFD700'}]}>TRANSFORMAÇÕES</Text>{transformations.map(s => (<TouchableOpacity key={s.id} style={styles.skillItem} onPress={() => activateSkill(s)}><View style={{flex:1}}><Text style={styles.skillName}>{s.name} <Text style={styles.skillCost}>({s.duration || 3} Rnds)</Text></Text><Text style={styles.skillDesc}>{s.description}</Text></View><View style={styles.activateBadge}><Text style={styles.activateText}>ATIVAR</Text></View></TouchableOpacity>))}</View>)}{activeSkills.length > 0 && (<View style={styles.skillSection}><Text style={[styles.skillHeader, {color:'#00B37E'}]}>ATIVAS</Text>{activeSkills.map(s => (<TouchableOpacity key={s.id} style={styles.skillItem} onPress={() => activateSkill(s)}><View style={{flex:1}}><Text style={styles.skillName}>{s.name} <Text style={styles.skillCost}>({s.cost || '-'})</Text></Text><Text style={styles.skillDesc}>{s.description}</Text></View><View style={[styles.activateBadge, {backgroundColor:'#00B37E'}]}><Text style={styles.activateText}>USAR</Text></View></TouchableOpacity>))}</View>)}{passives.length > 0 && (<View style={styles.skillSection}><Text style={[styles.skillHeader, {color:'#8257e5'}]}>PASSIVAS</Text>{passives.map(s => (<View key={s.id} style={styles.skillItem}><View><Text style={styles.skillName}>{s.name}</Text><Text style={styles.skillDesc}>{s.description}</Text></View></View>))}</View>)}</ScrollView></View></View></Modal>
      <Modal animationType="slide" transparent={true} visible={effectsListModalVisible} onRequestClose={() => setEffectsListModalVisible(false)}><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={[styles.modalTitle, {color: targetEffectType==='buff' ? '#00B37E' : '#ff4444'}]}>Adicionar {targetEffectType.toUpperCase()}</Text><TouchableOpacity onPress={() => setEffectsListModalVisible(false)}><Ionicons name="close" size={24} color="#ccc" /></TouchableOpacity></View><FlatList data={filteredEffects} keyExtractor={item => item.id} ListEmptyComponent={<Text style={{color:'#777', textAlign:'center', marginTop:20}}>Nenhum efeito cadastrado.</Text>} renderItem={({item}) => (<TouchableOpacity style={styles.skillItem} onPress={() => applyStatusEffect(item)}><View style={{flex:1}}><Text style={styles.skillName}>{item.title} {item.damage ? <Text style={{color:'#ff4444', fontSize:12}}> [{item.damage}]</Text> : null}</Text><Text style={styles.skillDesc}>{item.description} {item.duration ? `(${item.duration} rnds)` : ''}</Text></View><Ionicons name="add-circle" size={28} color={targetEffectType==='buff' ? '#00B37E' : '#ff4444'} /></TouchableOpacity>)}/></View></View></Modal>
      <Modal animationType="fade" transparent={true} visible={eventModalVisible} onRequestClose={() => setEventModalVisible(false)}><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>📜 Missão</Text><TouchableOpacity onPress={() => setEventModalVisible(false)}><Ionicons name="close" size={24} color="#ccc" /></TouchableOpacity></View>{gameEvent ? (<ScrollView>{gameEvent.image_url && <Image source={{uri: gameEvent.image_url}} style={{width:'100%', height:180, borderRadius:8, marginBottom:15}} resizeMode='cover' />}<Text style={styles.eventTitle}>{gameEvent.title}</Text><Text style={styles.eventDesc}>{gameEvent.description}</Text></ScrollView>) : <View style={{alignItems:'center', padding: 20}}><ActivityIndicator size="large" color="#FFD700" /><Text style={{color:'#777', marginTop:20}}>Carregando...</Text></View>}<TouchableOpacity style={[styles.passTurnButton, {marginTop:20, backgroundColor:'#333'}]} onPress={() => setEventModalVisible(false)}><Text style={[styles.passTurnText, {color:'#fff', fontSize:14}]}>OK</Text></TouchableOpacity></View></View></Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121214', paddingTop: 50 },
  loading: { flex: 1, backgroundColor: '#121214', justifyContent:'center', alignItems:'center' },
  scrollContent: { padding: 20, paddingBottom: 120 },
  turnHeader: { backgroundColor: '#202024', padding: 15, paddingTop: 50, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#333', flexDirection:'row', justifyContent:'space-between' },
  myTurnHeader: { backgroundColor: '#3e2e6b', borderBottomColor: '#8257e5' },
  turnText: { color: '#fff', fontSize: 16, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
  missionBtn: { flexDirection:'row', alignItems:'center', backgroundColor:'rgba(0,0,0,0.3)', padding:8, borderRadius:20 },
  missionBtnText: { color:'#fff', fontSize:12, fontWeight:'bold' },
  charArea: { flexDirection: 'row', alignItems: 'center', marginBottom: 25, marginTop: 10 },
  charImage: { width: 80, height: 80, borderRadius: 40, marginRight: 15, borderWidth: 2, borderColor: '#8257e5' },
  charPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#333', marginRight: 15, alignItems: 'center', justifyContent: 'center' },
  charName: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  charClass: { color: '#8257e5', fontSize: 16 },
  playerNameTag: { color: '#777', fontSize: 14, fontStyle: 'italic' },
  statsCard: { backgroundColor: '#202024', borderRadius: 12, padding: 15, marginBottom: 15 },
  label: { color: '#ccc', fontSize: 12, fontWeight: 'bold' },
  hpControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hpBtn: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  hpDisplay: { alignItems: 'center' },
  hpValue: { color: '#fff', fontSize: 42, fontWeight: 'bold' },
  sectionTitle: { color: '#fff', fontSize: 18, marginTop: 20, marginBottom: 10, fontWeight:'bold', borderBottomWidth: 1, borderBottomColor: '#333', paddingBottom: 5 },
  participantRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: '#222', alignItems: 'center' },
  activeRow: { backgroundColor: 'rgba(255, 215, 0, 0.1)', borderRadius: 8, borderBottomWidth: 0, borderLeftWidth: 3, borderLeftColor: '#FFD700' },
  pName: { color: '#ccc', fontSize: 16 },
  pSubName: { color: '#555', fontSize: 12 },
  pHp: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: '#121214', borderTopWidth: 1, borderTopColor: '#333', elevation: 10 },
  passTurnButton: { backgroundColor: '#FFD700', padding: 18, borderRadius: 12, alignItems: 'center', elevation: 5 },
  passTurnText: { color: '#000', fontWeight: 'bold', fontSize: 16 },
  waitingBox: { backgroundColor: '#202024', padding: 15, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  waitingText: { color: '#aaa', fontStyle: 'italic' },
  exitButton: { alignItems: 'center', marginTop: 15 },
  skillsButton: { flexDirection:'row', backgroundColor:'#333', padding:15, borderRadius:8, alignItems:'center', justifyContent:'center', marginVertical:10, borderWidth:1, borderColor:'#FFD700' },
  skillsButtonText: { color:'#FFD700', fontWeight:'bold', fontSize:14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding:20 },
  modalContent: { backgroundColor: '#18181B', borderRadius: 24, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  eventTitle: { color: '#FFD700', fontSize: 22, fontWeight: 'bold', marginBottom: 10, textAlign:'center' },
  eventDesc: { color: '#ddd', fontSize: 16, lineHeight: 24, textAlign:'justify' },
  skillSection: { marginBottom: 20 },
  skillHeader: { fontSize: 12, fontWeight: 'bold', marginBottom: 10, letterSpacing: 1 },
  skillItem: { backgroundColor: '#202024', padding: 12, borderRadius: 8, marginBottom: 8, flexDirection:'row', alignItems:'center' },
  skillName: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  skillCost: { color: '#777', fontSize: 12, fontWeight:'normal' },
  skillDesc: { color: '#aaa', fontSize: 12, marginTop: 4 },
  activateBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor:'#FFD700' },
  activateText: { color: '#000', fontSize: 10, fontWeight: 'bold' },
  activeTransBadge: { backgroundColor:'rgba(255, 215, 0, 0.2)', borderWidth:1, borderColor:'#FFD700', paddingHorizontal:8, paddingVertical:4, borderRadius:4, marginRight:5, marginBottom:5 },
  activeTransText: { color:'#FFD700', fontSize:12, fontWeight:'bold' },
  phaseDot: { width:8, height:8, borderRadius:4, backgroundColor:'#444', marginHorizontal:2 },
  phaseLine: { width:20, height:2, backgroundColor:'#444' },
  phaseText: { marginLeft: 10, fontSize: 12, fontWeight:'bold', letterSpacing:1 },
  addMemberBtn: { flexDirection:'row', alignItems:'center', backgroundColor:'#FFD700', paddingHorizontal:8, paddingVertical:4, borderRadius:12 },
  addMemberText: { color:'#000', fontSize:10, fontWeight:'bold' },
  
  // ESTILOS DE UNIDADE (EQUIPE)
  teamContainer: { backgroundColor: '#202024', borderRadius: 12, padding: 15, marginBottom: 15 },
  unitRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10, borderBottomWidth:1, borderBottomColor:'#333', paddingBottom:5 },
  unitName: { color:'#fff', fontSize:16, fontWeight:'bold', flex:1 },
  unitControls: { flexDirection:'row', alignItems:'center' },
  miniBtn: { width:30, height:30, borderRadius:15, alignItems:'center', justifyContent:'center' },
  unitHp: { color:'#fff', fontSize:18, fontWeight:'bold', marginHorizontal:10 }
});