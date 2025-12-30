// src/screens/GameScreen.tsx
import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, 
  Alert, Image, ActivityIndicator, Modal, FlatList 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { Room, RoomParticipant, GameCharacter, GameEvent, CharacterSkill, ActiveTransformation, StatusEffect, ActiveStatusEffect } from '../types/rpg';
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
  
  const [skillsModalVisible, setSkillsModalVisible] = useState(false);
  const [effectsListModalVisible, setEffectsListModalVisible] = useState(false);
  const [targetEffectType, setTargetEffectType] = useState<'buff' | 'debuff'>('buff');

  const [gameEvent, setGameEvent] = useState<GameEvent | null>(null);
  const [eventModalVisible, setEventModalVisible] = useState(false);
  
  const currentEventIdRef = useRef<string | null>(null);
  const hasShownEventRef = useRef(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const prevTurnIdRef = useRef<string | null>(null);

  const [hp, setHp] = useState(10);
  const [maxHp, setMaxHp] = useState(10);
  const [buffs, setBuffs] = useState('');
  const [debuffs, setDebuffs] = useState('');

  useEffect(() => {
    fetchGameData();
    subscribeToGame();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, []);

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
                if (hp === 10 && maxHp === 10 && buffs === '' && !currentEventIdRef.current) {
                    setHp(me.current_hp); setMaxHp(me.max_hp); setBuffs(me.buffs || ''); setDebuffs(me.debuffs || '');
                }
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

  const handlePassTurn = async () => {
    if (!room || !participants.length || !room.current_turn_participant_id) return;
    if (myParticipant && room.current_turn_participant_id === myParticipant.id) {
        await processEndTurnLogic();
    }
    const currentIndex = participants.findIndex(p => p.id === room.current_turn_participant_id);
    const nextIndex = (currentIndex + 1) % participants.length;
    await supabase.from('rooms').update({ current_turn_participant_id: participants[nextIndex].id }).eq('code', roomCode);
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
          if (b.duration === -1) { buffsExpired.push(b.name); return false; }
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
                  totalDamageTaken += dmgVal;
                  damageSources.push(`${d.name} (${dmgVal})`);
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
      if (totalDamageTaken > 0) alertMsg += `💥 Você sofreu ${totalDamageTaken} de dano por: ${damageSources.join(', ')}.\n`;
      if (transExpired.length > 0) alertMsg += `❌ Transformações acabaram: ${transExpired.join(', ')}.\n`;
      if (buffsExpired.length > 0 || debuffsExpired.length > 0) alertMsg += `⌛ Efeitos expiraram: ${[...buffsExpired, ...debuffsExpired].join(', ')}.`;

      if (alertMsg) Alert.alert("Resumo do Turno", alertMsg);
  };

  const checkTurnChange = async (currentTurnParticipantId: string) => {
      const myId = participants.find(p => p.user_id === userId)?.id;
      if (myId && prevTurnIdRef.current && prevTurnIdRef.current !== myId && currentTurnParticipantId === myId) {
          console.log("⚡ É MEU TURNO!");
      }
      prevTurnIdRef.current = currentTurnParticipantId;
  };

  const updateMyStats = async (newHp: number, newMax: number, newBuffs: string, newDebuffs: string) => {
    if (!myParticipant) return;
    await supabase.from('room_participants').update({ current_hp: newHp, max_hp: newMax, buffs: newBuffs, debuffs: newDebuffs }).eq('id', myParticipant.id);
  };
  const changeHp = (amount: number) => { const newVal = Math.max(0, Math.min(maxHp, hp + amount)); setHp(newVal); updateMyStats(newVal, maxHp, buffs, debuffs); };
  const changeMaxHp = (amount: number) => { const newVal = Math.max(1, maxHp + amount); setMaxHp(newVal); const fixedHp = Math.min(hp, newVal); if (fixedHp !== hp) setHp(fixedHp); supabase.from('room_participants').update({ max_hp: newVal, current_hp: fixedHp }).eq('id', myParticipant?.id); };

  // CORREÇÃO: Função assíncrona para garantir a exclusão
  const removeStatusEffect = async (effectName: string, type: 'buff' | 'debuff') => {
      if (!myParticipant) return;
      
      if (type === 'buff') {
          const newArr = (myParticipant.active_buffs || []).filter(e => e.name !== effectName);
          const { error } = await supabase.from('room_participants').update({ active_buffs: newArr }).eq('id', myParticipant.id);
          if (error) Alert.alert("Erro", "Falha ao remover buff.");
      } else {
          const newArr = (myParticipant.active_debuffs || []).filter(e => e.name !== effectName);
          const { error } = await supabase.from('room_participants').update({ active_debuffs: newArr }).eq('id', myParticipant.id);
          if (error) Alert.alert("Erro", "Falha ao remover debuff.");
      }
  };

  const activateSkill = async (skill: CharacterSkill) => {
      if (skill.type === 'transformation') {
          const currentList = myParticipant?.active_transformations || [];
          if (currentList.some(t => t.name === skill.name)) { Alert.alert("Já ativo", `${skill.name} já está ativa.`); return; }
          const baseDuration = (skill.duration && skill.duration > 0) ? skill.duration : 3;
          const durationWithBuffer = baseDuration + 1;
          const newList = [...currentList, { name: skill.name, rounds_left: durationWithBuffer }];
          await supabase.from('room_participants').update({ active_transformations: newList }).eq('id', myParticipant?.id);
          Alert.alert("Transformação!", `${skill.name} ativada por ${baseDuration} rodadas.`);
      } else {
          const newBuffs = buffs ? `${buffs}, ${skill.name}` : skill.name;
          setBuffs(newBuffs);
          await supabase.from('room_participants').update({ buffs: newBuffs }).eq('id', myParticipant?.id);
          Alert.alert("Habilidade", `${skill.name} usada!`);
      }
      setSkillsModalVisible(false);
  };

  const openEffectList = (type: 'buff' | 'debuff') => {
      setTargetEffectType(type);
      setEffectsListModalVisible(true);
  };

  const applyStatusEffect = async (effect: StatusEffect) => {
      if (!myParticipant) return;
      
      const baseDuration = (effect.duration && effect.duration > 0) ? effect.duration : 0; 
      const finalDuration = targetEffectType === 'buff' ? (baseDuration > 0 ? baseDuration + 1 : 0) : baseDuration;

      const newEffect: ActiveStatusEffect = {
          name: effect.title, description: effect.description, damage: effect.damage, duration: finalDuration 
      };

      if (targetEffectType === 'buff') {
          const currentBuffs = myParticipant.active_buffs || [];
          if (currentBuffs.some(b => b.name === newEffect.name)) { Alert.alert("Repetido", "Já possui esse buff."); return; }
          await supabase.from('room_participants').update({ active_buffs: [...currentBuffs, newEffect] }).eq('id', myParticipant.id);
      } else {
          const currentDebuffs = myParticipant.active_debuffs || [];
          if (currentDebuffs.some(d => d.name === newEffect.name)) { Alert.alert("Repetido", "Já possui esse debuff."); return; }
          await supabase.from('room_participants').update({ active_debuffs: [...currentDebuffs, newEffect] }).eq('id', myParticipant.id);
      }
      setEffectsListModalVisible(false);
  };

  const getVisualDuration = (dur: number, type: 'buff' | 'debuff' | 'trans') => {
      if (dur <= 0) return '∞';
      if (type === 'debuff') return `${dur}`; 
      return `${Math.max(dur - 1, 0)}`; 
  };

  function getEffectsArray(str: string | undefined) { if (!str) return []; return str.split(',').map(s => s.trim()).filter(s => s.length > 0); }

  if (!myParticipant || !room) return <View style={styles.loading}><ActivityIndicator size="large" color="#8257e5" /><Text style={{color:'#fff'}}>Carregando...</Text><TouchableOpacity onPress={onExitGame} style={{marginTop:20, padding:10, backgroundColor:'#333', borderRadius:8}}><Text style={{color:'#fff'}}>Sair</Text></TouchableOpacity></View>;

  const isMyTurn = room.current_turn_participant_id === myParticipant.id;
  const myChar = myParticipant.selected_character_id ? charactersMap[myParticipant.selected_character_id] : null;
  const currentPlayer = participants.find(p => p.id === room.current_turn_participant_id);
  
  const transformations = mySkills.filter(s => s.type === 'transformation');
  const activeSkills = mySkills.filter(s => s.type === 'active');
  const passives = mySkills.filter(s => s.type === 'passive');
  const filteredEffects = catalogEffects.filter(e => e.type === targetEffectType);
  
  const buffsArray = getEffectsArray(buffs);
  const debuffsArray = getEffectsArray(debuffs);

  return (
    <View style={styles.container}>
      <View style={[styles.turnHeader, isMyTurn ? styles.myTurnHeader : {}]}>
        <Text style={styles.turnText}>{isMyTurn ? "🔥 SUA VEZ!" : `Vez de: ${currentPlayer?.username || '...'}`}</Text>
        <TouchableOpacity style={styles.missionBtn} onPress={() => setEventModalVisible(true)}><Ionicons name="map" color="#fff" size={16} /><Text style={styles.missionBtnText}> Missão</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.charArea}>
            {myChar?.image_url ? <Image source={{ uri: myChar.image_url }} style={styles.charImage} /> : <View style={styles.charPlaceholder}><Ionicons name="person" size={40} color="#fff" /></View>}
            <View><Text style={styles.charName}>{myChar?.name || 'Unknown'}</Text><Text style={styles.charClass}>{myChar?.base_class}</Text><Text style={styles.playerNameTag}>({myParticipant.username})</Text></View>
        </View>

        <View style={styles.statsCard}>
            <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}>
                <Text style={styles.label}>HP</Text>
                <View style={{flexDirection:'row', alignItems:'center'}}><Text style={[styles.label, {color:'#777', marginRight:5}]}>Max:</Text><TouchableOpacity onPress={() => changeMaxHp(-1)}><Ionicons name="remove-circle" color="#555" size={24}/></TouchableOpacity><Text style={{color:'#fff', fontWeight:'bold', marginHorizontal:5, fontSize:16}}>{maxHp}</Text><TouchableOpacity onPress={() => changeMaxHp(1)}><Ionicons name="add-circle" color="#555" size={24}/></TouchableOpacity></View>
            </View>
            <View style={styles.hpControls}><TouchableOpacity onPress={() => changeHp(-1)} style={[styles.hpBtn, {backgroundColor: '#ff4444'}]}><Ionicons name="remove" size={32} color="#fff" /></TouchableOpacity><View style={styles.hpDisplay}><Text style={styles.hpValue}>{hp}</Text></View><TouchableOpacity onPress={() => changeHp(1)} style={[styles.hpBtn, {backgroundColor: '#00B37E'}]}><Ionicons name="add" size={32} color="#fff" /></TouchableOpacity></View>
        </View>

        {myParticipant.active_transformations && myParticipant.active_transformations.length > 0 && (
            <View style={{marginBottom: 10}}>
                <Text style={[styles.label, {color:'#FFD700', marginBottom:5}]}>TRANSFORMAÇÕES:</Text>
                <View style={{flexDirection:'row', flexWrap:'wrap'}}>
                    {myParticipant.active_transformations.map((t, idx) => (
                        <View key={`t-${idx}`} style={styles.activeTransBadge}>
                            <Text style={styles.activeTransText}>{t.name} ({getVisualDuration(t.rounds_left, 'trans')} rnds)</Text>
                        </View>
                    ))}
                </View>
            </View>
        )}

        {/* BUFFS */}
        <View style={[styles.statsCard, {marginBottom:10}]}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5}}>
                <Text style={[styles.label, {color:'#00B37E', marginBottom:0}]}>BUFFS</Text>
                <TouchableOpacity onPress={() => openEffectList('buff')}><Ionicons name="add-circle" size={24} color="#00B37E" /></TouchableOpacity>
            </View>
            <View style={{flexDirection:'row', flexWrap:'wrap', minHeight: 30}}>
                {(!myParticipant.active_buffs?.length && !buffs) ? <Text style={{color:'#555', fontStyle:'italic', fontSize:12, marginTop:5}}>Nenhum buff.</Text> : null}
                {myParticipant.active_buffs?.map((b, idx) => (
                    <TouchableOpacity key={`ab-${idx}`} style={[styles.activeTransBadge, {borderColor:'#00B37E', backgroundColor:'rgba(0, 179, 126, 0.1)', flexDirection:'row', alignItems:'center'}]} onPress={() => removeStatusEffect(b.name, 'buff')}>
                        <Text style={[styles.activeTransText, {color:'#00B37E', marginRight:5}]}>
                            {b.name} ({getVisualDuration(b.duration, 'buff')})
                        </Text>
                        <Ionicons name="close" size={12} color="#00B37E" />
                    </TouchableOpacity>
                ))}
                {buffsArray.map((b, idx) => (
                    <TouchableOpacity key={`oldb-${idx}`} style={[styles.activeTransBadge, {borderColor:'#00B37E', backgroundColor:'rgba(0, 179, 126, 0.1)', flexDirection:'row', alignItems:'center'}]} onPress={() => {const newArr = buffsArray.filter(x => x !== b).join(', '); setBuffs(newArr); updateMyStats(hp, maxHp, newArr, debuffs);}}>
                        <Text style={[styles.activeTransText, {color:'#00B37E', marginRight:5}]}>{b}</Text>
                        <Ionicons name="close" size={12} color="#00B37E" />
                    </TouchableOpacity>
                ))}
            </View>
        </View>

        {/* DEBUFFS */}
        <View style={[styles.statsCard, {marginBottom:10}]}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5}}>
                <Text style={[styles.label, {color:'#ff4444', marginBottom:0}]}>DEBUFFS</Text>
                <TouchableOpacity onPress={() => openEffectList('debuff')}><Ionicons name="add-circle" size={24} color="#ff4444" /></TouchableOpacity>
            </View>
            <View style={{flexDirection:'row', flexWrap:'wrap', minHeight: 30}}>
                {(!myParticipant.active_debuffs?.length && !debuffs) ? <Text style={{color:'#555', fontStyle:'italic', fontSize:12, marginTop:5}}>Nenhum debuff.</Text> : null}
                {myParticipant.active_debuffs?.map((d, idx) => (
                    <TouchableOpacity key={`ad-${idx}`} style={[styles.activeTransBadge, {borderColor:'#ff4444', backgroundColor:'rgba(255, 68, 68, 0.1)', flexDirection:'row', alignItems:'center'}]} onPress={() => removeStatusEffect(d.name, 'debuff')}>
                        <Text style={[styles.activeTransText, {color:'#ff4444', marginRight:5}]}>
                            {d.name} {d.damage ? `[${d.damage}]` : ''} ({getVisualDuration(d.duration, 'debuff')})
                        </Text>
                        <Ionicons name="close" size={12} color="#ff4444" />
                    </TouchableOpacity>
                ))}
                {debuffsArray.map((d, idx) => (
                    <TouchableOpacity key={`oldd-${idx}`} style={[styles.activeTransBadge, {borderColor:'#ff4444', backgroundColor:'rgba(255, 68, 68, 0.1)', flexDirection:'row', alignItems:'center'}]} onPress={() => {const newArr = debuffsArray.filter(x => x !== d).join(', '); setDebuffs(newArr); updateMyStats(hp, maxHp, buffs, newArr);}}>
                        <Text style={[styles.activeTransText, {color:'#ff4444', marginRight:5}]}>{d}</Text>
                        <Ionicons name="close" size={12} color="#ff4444" />
                    </TouchableOpacity>
                ))}
            </View>
        </View>

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
                       <Text style={styles.pSubName}>{pChar?.name}</Text>
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

      <View style={styles.footer}>{isMyTurn ? <TouchableOpacity style={styles.passTurnButton} onPress={handlePassTurn}><Text style={styles.passTurnText}>PASSAR TURNO ⏭️</Text></TouchableOpacity> : <View style={styles.waitingBox}><ActivityIndicator size="small" color="#aaa" style={{marginRight: 10}}/><Text style={styles.waitingText}>Aguardando {currentPlayer?.username}...</Text></View>} <TouchableOpacity style={styles.exitButton} onPress={onExitGame}><Text style={{color:'#777'}}>Sair</Text></TouchableOpacity></View>

      <Modal animationType="slide" transparent={true} visible={skillsModalVisible} onRequestClose={() => setSkillsModalVisible(false)}><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>⚡ Habilidades</Text><TouchableOpacity onPress={() => setSkillsModalVisible(false)}><Ionicons name="close" size={24} color="#ccc" /></TouchableOpacity></View><ScrollView>{mySkills.length === 0 && <Text style={{color:'#777', textAlign:'center', marginTop: 20}}>Nenhuma habilidade cadastrada.</Text>}{transformations.length > 0 && (<View style={styles.skillSection}><Text style={[styles.skillHeader, {color:'#FFD700'}]}>TRANSFORMAÇÕES</Text>{transformations.map(s => (<TouchableOpacity key={s.id} style={styles.skillItem} onPress={() => activateSkill(s)}><View style={{flex:1}}><Text style={styles.skillName}>{s.name} <Text style={styles.skillCost}>({s.duration || 3} Rnds)</Text></Text><Text style={styles.skillDesc}>{s.description}</Text></View><View style={styles.activateBadge}><Text style={styles.activateText}>ATIVAR</Text></View></TouchableOpacity>))}</View>)}{activeSkills.length > 0 && (<View style={styles.skillSection}><Text style={[styles.skillHeader, {color:'#00B37E'}]}>ATIVAS</Text>{activeSkills.map(s => (<TouchableOpacity key={s.id} style={styles.skillItem} onPress={() => activateSkill(s)}><View style={{flex:1}}><Text style={styles.skillName}>{s.name} <Text style={styles.skillCost}>({s.cost || '-'})</Text></Text><Text style={styles.skillDesc}>{s.description}</Text></View><View style={[styles.activateBadge, {backgroundColor:'#00B37E'}]}><Text style={styles.activateText}>USAR</Text></View></TouchableOpacity>))}</View>)}{passives.length > 0 && (<View style={styles.skillSection}><Text style={[styles.skillHeader, {color:'#8257e5'}]}>PASSIVAS</Text>{passives.map(s => (<View key={s.id} style={styles.skillItem}><View><Text style={styles.skillName}>{s.name}</Text><Text style={styles.skillDesc}>{s.description}</Text></View></View>))}</View>)}</ScrollView></View></View></Modal>

      <Modal animationType="slide" transparent={true} visible={effectsListModalVisible} onRequestClose={() => setEffectsListModalVisible(false)}><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={[styles.modalTitle, {color: targetEffectType==='buff' ? '#00B37E' : '#ff4444'}]}>Adicionar {targetEffectType.toUpperCase()}</Text><TouchableOpacity onPress={() => setEffectsListModalVisible(false)}><Ionicons name="close" size={24} color="#ccc" /></TouchableOpacity></View><FlatList data={filteredEffects} keyExtractor={item => item.id} ListEmptyComponent={<Text style={{color:'#777', textAlign:'center', marginTop:20}}>Nenhum efeito cadastrado.</Text>} renderItem={({item}) => (<TouchableOpacity style={styles.skillItem} onPress={() => applyStatusEffect(item)}><View style={{flex:1}}><Text style={styles.skillName}>{item.title} {item.damage ? <Text style={{color:'#ff4444', fontSize:12}}> [{item.damage}]</Text> : null}</Text><Text style={styles.skillDesc}>{item.description} {item.duration ? `(${item.duration} rnds)` : ''}</Text></View><Ionicons name="add-circle" size={28} color={targetEffectType==='buff' ? '#00B37E' : '#ff4444'} /></TouchableOpacity>)}/></View></View></Modal>

      <Modal animationType="fade" transparent={true} visible={eventModalVisible} onRequestClose={() => setEventModalVisible(false)}><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>📜 Missão</Text><TouchableOpacity onPress={() => setEventModalVisible(false)}><Ionicons name="close" size={24} color="#ccc" /></TouchableOpacity></View>{gameEvent ? (<ScrollView>{gameEvent.image_url && <Image source={{uri: gameEvent.image_url}} style={{width:'100%', height:180, borderRadius:8, marginBottom:15}} resizeMode='cover' />}<Text style={styles.eventTitle}>{gameEvent.title}</Text><Text style={styles.eventDesc}>{gameEvent.description}</Text></ScrollView>) : <View style={{alignItems:'center', padding: 20}}><ActivityIndicator size="large" color="#FFD700" /><Text style={{color:'#777', marginTop:20}}>Carregando...</Text></View>}<TouchableOpacity style={[styles.passTurnButton, {marginTop:20, backgroundColor:'#333'}]} onPress={() => setEventModalVisible(false)}><Text style={[styles.passTurnText, {color:'#fff', fontSize:14}]}>OK</Text></TouchableOpacity></View></View></Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121214' },
  loading: { flex: 1, backgroundColor: '#121214', justifyContent:'center', alignItems:'center' },
  scrollContent: { padding: 20, paddingBottom: 120 },
  turnHeader: { backgroundColor: '#202024', padding: 15, paddingTop: 50, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#333', flexDirection:'row', justifyContent:'space-between' },
  myTurnHeader: { backgroundColor: '#3e2e6b', borderBottomColor: '#8257e5' },
  turnText: { color: '#fff', fontSize: 16, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, flex:1 },
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
  row: { flexDirection: 'row' },
  inputArea: { backgroundColor: '#121214', color: '#fff', borderRadius: 8, padding: 10, height: 80, textAlignVertical: 'top', borderWidth: 1, borderColor: '#333' },
  sectionTitle: { color: '#fff', fontSize: 18, marginTop: 20, marginBottom: 10, fontWeight:'bold', borderBottomWidth: 1, borderBottomColor: '#333', paddingBottom: 5 },
  participantRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: '#222', alignItems: 'center' },
  activeRow: { backgroundColor: 'rgba(255, 215, 0, 0.1)', borderRadius: 8, borderBottomWidth: 0, borderLeftWidth: 3, borderLeftColor: '#FFD700' },
  pName: { color: '#ccc', fontSize: 16 },
  pSubName: { color: '#555', fontSize: 12 },
  pHp: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: '#121214', borderTopWidth: 1, borderTopColor: '#333', elevation: 10 },
  passTurnButton: { backgroundColor: '#FFD700', padding: 18, borderRadius: 12, alignItems: 'center', elevation: 5 },
  passTurnText: { color: '#000', fontWeight: 'bold', fontSize: 18 },
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
  activeTransText: { color:'#FFD700', fontSize:12, fontWeight:'bold' }
});