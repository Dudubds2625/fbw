import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, TextInput, Alert, Image, ScrollView, Switch, ActivityIndicator, KeyboardAvoidingView, Platform 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { GameEvent, EventCharacter, CharacterSkill, EventItem } from '../types/rpg';

// --- INTERFACES LOCAIS ---
interface FactionSkillEntry {
    round: number;
    skill: CharacterSkill;
}

interface LocalFaction {
    id: string;
    name: string;
    skills: FactionSkillEntry[];
}

interface EventManagerProps {
  visible: boolean;
  onClose: () => void;
}

export default function EventManager({ visible, onClose }: EventManagerProps) {
  // ==================================================================================
  // 1. STATES GERAIS
  // ==================================================================================
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [createMode, setCreateMode] = useState(false);

  // ==================================================================================
  // 2. STATES DO FORMULÁRIO (PRINCIPAL)
  // ==================================================================================
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventImage, setNewEventImage] = useState('');
  const [pickedEventImageUri, setPickedEventImageUri] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Lógica de Modos (Checkbox)
  const [isFactionEvent, setIsFactionEvent] = useState(false);
  
  // NOVA REGRA: 3 Personagens -> 1 Boss
  const [hasThreeUnitsRule, setHasThreeUnitsRule] = useState(false);

  // Dados Complexos
  const [eventFactions, setEventFactions] = useState<LocalFaction[]>([]);
  const [factionCountInput, setFactionCountInput] = useState('4');
  const [eventCharacters, setEventCharacters] = useState<EventCharacter[]>([]);

  // Lógica de Itens
  const [hasItems, setHasItems] = useState(false);
  const [eventItems, setEventItems] = useState<EventItem[]>([]);

  // Lógica de Passivas
  const [hasPassives, setHasPassives] = useState(false);
  const [eventPassives, setEventPassives] = useState<CharacterSkill[]>([]);

  // ==================================================================================
  // 3. STATES DOS SUB-MODAIS
  // ==================================================================================
  
  // A. Modal Boss/Inimigo
  const [createEventCharModalVisible, setCreateEventCharModalVisible] = useState(false);
  const [editingEventCharIndex, setEditingEventCharIndex] = useState<number | null>(null);
  const [evCharName, setEvCharName] = useState('');
  const [evCharHp, setEvCharHp] = useState('10');
  const [evCharHasLife, setEvCharHasLife] = useState(true);
  const [evCharIsBoss, setEvCharIsBoss] = useState(false);
  // NOVO STATE PARA O PERSONAGEM
  const [evCharBecomesBoss, setEvCharBecomesBoss] = useState(false);
  const [evCharSkills, setEvCharSkills] = useState<CharacterSkill[]>([]);
  
  // B. Skill Form (Generico)
  const [editingEvCharSkillIndex, setEditingEvCharSkillIndex] = useState<number | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillCost, setSkillCost] = useState('');
  const [skillDuration, setSkillDuration] = useState('');
  const [skillType, setSkillType] = useState<'active' | 'passive' | 'transformation'>('active');
  const [skillCombatState, setSkillCombatState] = useState<'normal' | 'boss'>('normal');

  // C. Modal Facção
  const [editFactionModalVisible, setEditFactionModalVisible] = useState(false);
  const [currentEditingFactionId, setCurrentEditingFactionId] = useState<string | null>(null);
  const [currentFactionName, setCurrentFactionName] = useState('');
  const [currentFactionSkills, setCurrentFactionSkills] = useState<FactionSkillEntry[]>([]);

  // D. Modal Skill Facção
  const [selectFactionSkillModalVisible, setSelectFactionSkillModalVisible] = useState(false);
  const [factionSkillRoundInput, setFactionSkillRoundInput] = useState('1');
  const [factionSkillName, setFactionSkillName] = useState('');
  const [factionSkillDesc, setFactionSkillDesc] = useState('');

  // E. Modal de Item
  const [createItemModalVisible, setCreateItemModalVisible] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemDamage, setItemDamage] = useState('');
  const [itemHasAmmo, setItemHasAmmo] = useState(false);
  const [itemAmmoCount, setItemAmmoCount] = useState('');

  // F. Modal de Passiva
  const [createPassiveModalVisible, setCreatePassiveModalVisible] = useState(false);
  const [editingPassiveIndex, setEditingPassiveIndex] = useState<number | null>(null);
  const [passiveName, setPassiveName] = useState('');
  const [passiveDesc, setPassiveDesc] = useState('');


  // ==================================================================================
  // 4. EFEITOS
  // ==================================================================================
  useEffect(() => {
    if (visible) fetchEvents();
  }, [visible]);

  const fetchEvents = async () => {
    setLoading(true);
    const { data } = await supabase.from('game_events').select('*').order('title');
    if (data) setEvents(data);
    setLoading(false);
  };

  const uploadToSupabase = async (uri: string): Promise<string | null> => {
    try {
      setUploadingImage(true);
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const arrayBuffer = decode(base64);
      const fileExt = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const { error } = await supabase.storage.from('rpg-images').upload(fileName, arrayBuffer, { contentType: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}` });
      if (error) throw error;
      const { data } = supabase.storage.from('rpg-images').getPublicUrl(fileName);
      return data.publicUrl;
    } catch (error: any) {
      Alert.alert("Erro Upload", error.message);
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const pickEventImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [16, 9], quality: 0.5 });
    if (!result.canceled) setPickedEventImageUri(result.assets[0].uri);
  };

  // ==================================================================================
  // 5. LÓGICA DE FORMULÁRIO (PRINCIPAL)
  // ==================================================================================

  const openCreateEvent = () => {
      setEditingEventId(null); 
      setNewEventTitle(''); setNewEventDesc(''); setNewEventImage(''); setPickedEventImageUri('');
      setEventCharacters([]); 
      setIsFactionEvent(false);
      setHasThreeUnitsRule(false); // Reset nova regra
      setEventFactions([]); setFactionCountInput('4');
      
      setHasItems(false); setEventItems([]);
      setHasPassives(false); setEventPassives([]);
      
      setCreateMode(true);
  };

  const openEditEvent = (ev: GameEvent) => {
      setEditingEventId(ev.id); 
      setNewEventTitle(ev.title); 
      setNewEventDesc(ev.description); 
      setNewEventImage(ev.image_url || ''); 
      setPickedEventImageUri('');
      
      const isFaction = !!ev.is_faction_event;
      setIsFactionEvent(isFaction);

      // Carregar regra de 3 unidades
      setHasThreeUnitsRule(!!ev.has_three_units_boss_rule);

      const rawFactions = ev.factions as unknown as LocalFaction[] || [];
      const loadedFactions = JSON.parse(JSON.stringify(rawFactions));
      
      const rawChars = ev.event_characters || [];
      const loadedChars = JSON.parse(JSON.stringify(rawChars));

      if (isFaction) {
          setEventFactions(loadedFactions);
          setFactionCountInput(String(loadedFactions.length > 0 ? loadedFactions.length : 4));
          setEventCharacters([]); 
      } else {
          setEventCharacters(loadedChars);
          setEventFactions([]); 
          setFactionCountInput('4');
      }
      
      const loadedItems = ev.items ? JSON.parse(JSON.stringify(ev.items)) : [];
      setEventItems(loadedItems);
      setHasItems(loadedItems.length > 0);

      const loadedPassives = ev.passives ? JSON.parse(JSON.stringify(ev.passives)) : [];
      setEventPassives(loadedPassives);
      setHasPassives(loadedPassives.length > 0);

      setCreateMode(true);
  };

  const handleDeleteEvent = async (id: string) => {
      Alert.alert("Apagar", "Tem certeza?", [{text:"Cancelar"}, {text:"Apagar", onPress:async()=>{ await supabase.from('game_events').delete().eq('id',id); fetchEvents();}}]);
  };

  const handleSaveEvent = async () => {
      if(!newEventTitle) return Alert.alert("Erro", "Título obrigatório");
      
      const currentIsFaction = isFactionEvent;

      if (currentIsFaction && eventFactions.length < 2) return Alert.alert('Erro', 'Facções precisam de no mínimo 2 slots.');
      if (!currentIsFaction && eventCharacters.length === 0) return Alert.alert('Erro', 'Boss precisa de no mínimo 1 inimigo.');

      setSaving(true);
      try {
          let finalImageUrl = newEventImage;
          if (pickedEventImageUri) {
              const url = await uploadToSupabase(pickedEventImageUri);
              if (url) finalImageUrl = url;
          }

          const finalFactions = currentIsFaction ? eventFactions : [];
          const finalCharacters = currentIsFaction ? [] : eventCharacters;
          const finalItems = hasItems ? eventItems : [];
          const finalPassives = hasPassives ? eventPassives : [];

          const payload = {
              title: newEventTitle, 
              description: newEventDesc, 
              image_url: finalImageUrl || null,
              is_faction_event: currentIsFaction,
              has_three_units_boss_rule: hasThreeUnitsRule, // <--- NOVA REGRA NO PAYLOAD
              event_characters: finalCharacters,
              factions: finalFactions,
              items: finalItems,
              passives: finalPassives
          };

          if(editingEventId) await supabase.from('game_events').update(payload).eq('id', editingEventId);
          else await supabase.from('game_events').insert(payload);

          setCreateMode(false);
          await fetchEvents();
          Alert.alert("Sucesso", "Evento Salvo!");

      } catch (e: any) { 
          Alert.alert("Erro ao salvar", e.message); 
      } finally { 
          setSaving(false); 
      }
  };

  // ==================================================================================
  // 6. LÓGICA DE ITENS, PASSIVAS, E INIMIGOS
  // ==================================================================================

  // --- ITENS ---
  const openAddItem = () => {
      setItemName(''); setItemDesc(''); setItemDamage(''); 
      setItemHasAmmo(false); setItemAmmoCount('');
      setEditingItemIndex(null);
      setCreateItemModalVisible(true);
  };
  const openEditItem = (index: number) => {
      const item = eventItems[index];
      setItemName(item.name); setItemDesc(item.description); setItemDamage(item.damage);
      setItemHasAmmo(item.has_ammo); setItemAmmoCount(item.ammo_count ? String(item.ammo_count) : '');
      setEditingItemIndex(index);
      setCreateItemModalVisible(true);
  };
  const saveItem = () => {
      if(!itemName || !itemDamage) return Alert.alert("Erro", "Nome e Dano obrigatórios");
      const newItem: EventItem = {
          id: editingItemIndex !== null ? eventItems[editingItemIndex].id : Date.now().toString(),
          name: itemName, description: itemDesc, damage: itemDamage,
          has_ammo: itemHasAmmo, ammo_count: itemHasAmmo ? (parseInt(itemAmmoCount) || 0) : 0
      };
      if(editingItemIndex !== null) {
          const updated = [...eventItems]; updated[editingItemIndex] = newItem; setEventItems(updated);
      } else { setEventItems([...eventItems, newItem]); }
      setCreateItemModalVisible(false);
  };

  // --- PASSIVAS ---
  const openAddPassive = () => { setPassiveName(''); setPassiveDesc(''); setEditingPassiveIndex(null); setCreatePassiveModalVisible(true); };
  const openEditPassive = (index: number) => { const p = eventPassives[index]; setPassiveName(p.name); setPassiveDesc(p.description); setEditingPassiveIndex(index); setCreatePassiveModalVisible(true); };
  const savePassive = () => {
      if(!passiveName) return Alert.alert("Erro", "Nome obrigatório");
      const newPassive: CharacterSkill = {
          id: editingPassiveIndex !== null ? eventPassives[editingPassiveIndex].id : Date.now().toString(),
          name: passiveName, description: passiveDesc, type: 'passive', passive_type: 'general', duration: -1
      };
      if(editingPassiveIndex !== null) { const updated = [...eventPassives]; updated[editingPassiveIndex] = newPassive; setEventPassives(updated); } 
      else { setEventPassives([...eventPassives, newPassive]); }
      setCreatePassiveModalVisible(false);
  };

  // --- BOSS/INIMIGOS (COM NOVA REGRA) ---
  const clearSkillForm = () => { setSkillName(''); setSkillDesc(''); setSkillCost(''); setSkillDuration(''); setSkillType('active'); setSkillCombatState('normal'); };

  const openAddEventChar = () => {
      setEvCharName(''); setEvCharHp('10'); setEvCharHasLife(true); 
      setEvCharIsBoss(false); setEvCharBecomesBoss(false); // Reset
      setEvCharSkills([]);
      setEditingEventCharIndex(null); setEditingEvCharSkillIndex(null); clearSkillForm();
      setCreateEventCharModalVisible(true);
  };

  const openEditEventChar = (index: number) => {
      const char = eventCharacters[index];
      setEvCharName(char.name); setEvCharHp(String(char.base_hp)); setEvCharHasLife(char.has_life);
      setEvCharIsBoss(char.is_boss); 
      setEvCharBecomesBoss(!!char.becomes_boss_on_condition); // Carregar estado
      setEvCharSkills(char.skills || []);
      setEditingEventCharIndex(index); setEditingEvCharSkillIndex(null); clearSkillForm();
      setCreateEventCharModalVisible(true);
  };

  const addEvCharSkill = () => {
      if(!skillName) return Alert.alert("Ops", "Nome skill?");
      const newSkill: CharacterSkill = {
          id: editingEvCharSkillIndex !== null ? evCharSkills[editingEvCharSkillIndex].id : Math.random().toString(),
          name: skillName, description: skillDesc, cost: skillCost, type: skillType,
          duration: parseInt(skillDuration) || 0, combat_state: evCharIsBoss ? skillCombatState : 'normal'
      };
      if (editingEvCharSkillIndex !== null) { const up = [...evCharSkills]; up[editingEvCharSkillIndex] = newSkill; setEvCharSkills(up); }
      else { setEvCharSkills([...evCharSkills, newSkill]); }
      setEditingEvCharSkillIndex(null); clearSkillForm();
  };

  const handleEditEvCharSkill = (index: number) => {
      const s = evCharSkills[index];
      setSkillName(s.name); setSkillDesc(s.description); setSkillCost(s.cost||''); setSkillDuration(String(s.duration||''));
      setSkillType(s.type); setSkillCombatState(s.combat_state || 'normal');
      setEditingEvCharSkillIndex(index);
  };

  const saveEventChar = () => {
      if(!evCharName) return Alert.alert("Ops", "Nome?");
      const charData: EventCharacter = { 
          name: evCharName, base_hp: evCharHasLife ? (parseInt(evCharHp)||0) : 0, 
          has_life: evCharHasLife, 
          is_boss: evCharIsBoss, 
          becomes_boss_on_condition: evCharBecomesBoss, // Salva o novo campo
          skills: evCharSkills 
      };
      if (editingEventCharIndex !== null) { const up = [...eventCharacters]; up[editingEventCharIndex] = charData; setEventCharacters(up); }
      else { setEventCharacters([...eventCharacters, charData]); }
      setCreateEventCharModalVisible(false);
  };

  // -- FACÇÕES --
  const handleGenerateFactions = () => {
      const count = parseInt(factionCountInput);
      if (isNaN(count) || count < 2) return Alert.alert("Erro", "Mínimo 2.");
      const newFactions: LocalFaction[] = [];
      for(let i=0; i<count; i++) {
          if (eventFactions[i]) newFactions.push(eventFactions[i]);
          else newFactions.push({ id: `temp_${Date.now()}_${i}`, name: `Facção ${i+1}`, skills: [] });
      }
      setEventFactions(newFactions);
  };

  const openEditFaction = (f: LocalFaction) => {
      setCurrentEditingFactionId(f.id); setCurrentFactionName(f.name); setCurrentFactionSkills(f.skills || []);
      setEditFactionModalVisible(true);
  };

  const saveCurrentFaction = () => {
      if (!currentEditingFactionId || !currentFactionName) return;
      setEventFactions(prev => prev.map(f => f.id === currentEditingFactionId ? { ...f, name: currentFactionName, skills: currentFactionSkills } : f));
      setEditFactionModalVisible(false);
  };

  const handleAddFactionSkill = () => {
      if (!factionSkillName) return Alert.alert("Erro", "Nome?");
      const newSkill: CharacterSkill = { id: Date.now().toString(), name: factionSkillName, description: factionSkillDesc, type: 'passive', passive_type: 'individual', duration: -1 };
      const newEntry: FactionSkillEntry = { round: parseInt(factionSkillRoundInput)||1, skill: newSkill };
      setCurrentFactionSkills([...currentFactionSkills, newEntry].sort((a,b) => a.round - b.round));
      setFactionSkillName(''); setFactionSkillDesc(''); setSelectFactionSkillModalVisible(false);
  };

  // ==================================================================================
  // 7. RENDERIZAÇÃO
  // ==================================================================================

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, createMode ? { height: '90%' } : { maxHeight: '90%' }]}>
            
            {!createMode ? (
                // --- LISTA ---
                <>
                    <View style={styles.header}>
                        <Text style={styles.title}>Gerenciar Eventos</Text>
                        <View style={{flexDirection:'row'}}>
                            <TouchableOpacity onPress={openCreateEvent} style={{marginRight:15}}><Ionicons name="add-circle" size={28} color="#00B37E"/></TouchableOpacity>
                            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#ccc"/></TouchableOpacity>
                        </View>
                    </View>
                    {loading ? <ActivityIndicator color="#8257e5" /> : (
                        <FlatList 
                            data={events}
                            keyExtractor={item => item.id}
                            renderItem={({item}) => (
                                <View style={styles.itemRow}>
                                    <View style={{flex:1}}>
                                        <Text style={{color:'#fff', fontWeight:'bold'}}>{item.title}</Text>
                                        <Text style={{color:'#777', fontSize:10}}>{item.is_faction_event ? 'FACÇÃO' : 'BOSS'}</Text>
                                    </View>
                                    <TouchableOpacity onPress={() => openEditEvent(item)} style={{marginRight:15}}><Ionicons name="pencil" size={20} color="#8257e5"/></TouchableOpacity>
                                    <TouchableOpacity onPress={() => handleDeleteEvent(item.id)}><Ionicons name="trash" size={20} color="#ff4444"/></TouchableOpacity>
                                </View>
                            )}
                        />
                    )}
                </>
            ) : (
                // --- FORMULÁRIO ---
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1}}>
                    <ScrollView contentContainerStyle={{paddingBottom: 20}}>
                        <View style={styles.header}>
                            <Text style={styles.title}>{editingEventId ? "Editar Evento" : "Criar Evento"}</Text>
                        </View>

                        <TouchableOpacity onPress={pickEventImage} style={styles.imagePickerBtn}>
                            {pickedEventImageUri ? <Image source={{uri:pickedEventImageUri}} style={styles.imagePreview}/> : newEventImage ? <Image source={{uri:newEventImage}} style={styles.imagePreview}/> : <View style={{alignItems:'center'}}><Ionicons name="image" size={30} color="#777"/><Text style={{color:'#777'}}>Capa do Evento</Text></View>}
                        </TouchableOpacity>

                        <TextInput style={styles.input} placeholder="Título" placeholderTextColor="#555" value={newEventTitle} onChangeText={setNewEventTitle}/>
                        <TextInput style={[styles.input, {height:80, textAlignVertical:'top'}]} placeholder="Descrição" placeholderTextColor="#555" value={newEventDesc} onChangeText={setNewEventDesc} multiline/>
                        
                        {/* CHECKBOX FACÇÃO */}
                        <View style={styles.checkboxContainer}>
                            <Text style={styles.checkboxLabel}>Este é um evento de Facção?</Text>
                            <Switch 
                                value={isFactionEvent} 
                                onValueChange={(val) => {
                                    setIsFactionEvent(val);
                                    if(val) setEventCharacters([]); 
                                    else setEventFactions([]);
                                }} 
                                trackColor={{false: '#333', true: '#FFD700'}} 
                                thumbColor={'#fff'} 
                            />
                        </View>

                        {/* NOVA REGRA: 3 UNITS = BOSS */}
                        {!isFactionEvent && (
                            <View style={[styles.checkboxContainer, {borderColor: '#ff8800'}]}>
                                <Text style={styles.checkboxLabel}>Ativar Regra: 3 Inimigos = 1 Boss?</Text>
                                <Switch 
                                    value={hasThreeUnitsRule} 
                                    onValueChange={setHasThreeUnitsRule}
                                    trackColor={{false: '#333', true: '#ff8800'}} 
                                    thumbColor={'#fff'} 
                                />
                            </View>
                        )}

                        {isFactionEvent ? (
                            <View style={styles.sectionContainer}>
                                <Text style={[styles.sectionTitle, {color:'#FFD700'}]}>FACÇÕES</Text>
                                <View style={{flexDirection:'row', alignItems:'center', marginBottom:15}}>
                                    <TextInput style={[styles.input, {flex:1, marginBottom:0, marginRight:10}]} value={factionCountInput} onChangeText={setFactionCountInput} placeholder="Qtd" keyboardType="numeric"/>
                                    <TouchableOpacity style={styles.actionBtn} onPress={handleGenerateFactions}><Text style={{color:'#000', fontWeight:'bold'}}>GERAR</Text></TouchableOpacity>
                                </View>
                                {eventFactions.map((f, i) => (
                                    <TouchableOpacity key={i} style={styles.listItem} onPress={() => openEditFaction(f)}>
                                        <View><Text style={{color:'#fff', fontWeight:'bold'}}>{f.name}</Text><Text style={{color:'#aaa', fontSize:10}}>{f.skills?.length||0} Skills</Text></View>
                                        <Ionicons name="pencil" color="#FFD700" size={18} />
                                    </TouchableOpacity>
                                ))}
                            </View>
                        ) : (
                            <View style={styles.sectionContainer}>
                                <Text style={[styles.sectionTitle, {color:'#00B37E'}]}>INIMIGOS</Text>
                                {eventCharacters.map((char, idx) => (
                                    <View key={idx} style={[styles.listItem, {borderLeftWidth:4, borderLeftColor: char.is_boss ? '#ff4444' : (char.becomes_boss_on_condition ? '#ff8800' : '#777')}]}>
                                        <View>
                                            <Text style={{color:'#fff', fontWeight:'bold'}}>{char.name}</Text>
                                            <Text style={{color:'#aaa', fontSize:10}}>
                                                {char.base_hp} HP
                                                {char.becomes_boss_on_condition ? ' • [VIRA BOSS]' : ''}
                                            </Text>
                                        </View>
                                        <View style={{flexDirection:'row'}}>
                                            <TouchableOpacity onPress={()=>openEditEventChar(idx)} style={{marginRight:10}}><Ionicons name="pencil" size={18} color="#FFD700" /></TouchableOpacity>
                                            <TouchableOpacity onPress={()=>{const u=[...eventCharacters];u.splice(idx,1);setEventCharacters(u)}}><Ionicons name="trash" size={18} color="#ff4444" /></TouchableOpacity>
                                        </View>
                                    </View>
                                ))}
                                <TouchableOpacity onPress={openAddEventChar} style={[styles.dashedBtn, {borderColor:'#00B37E'}]}><Text style={{color:'#00B37E'}}>+ Adicionar Personagem</Text></TouchableOpacity>
                            </View>
                        )}

                        {/* SECÇÃO DE ITENS */}
                        <View style={[styles.checkboxContainer, {marginTop: 15, borderColor: '#44aaff'}]}>
                            <Text style={styles.checkboxLabel}>Adicionar Itens / Loot?</Text>
                            <Switch value={hasItems} onValueChange={setHasItems} trackColor={{false: '#333', true: '#44aaff'}} thumbColor={'#fff'} />
                        </View>

                        {hasItems && (
                           <View style={styles.sectionContainer}>
                               <Text style={[styles.sectionTitle, {color:'#44aaff'}]}>ITENS DO EVENTO</Text>
                               {eventItems.map((item, idx) => (
                                   <View key={idx} style={styles.listItem}>
                                       <View style={{flex:1}}>
                                           <Text style={{color:'#fff', fontWeight:'bold'}}>{item.name}</Text>
                                           <Text style={{color:'#aaa', fontSize:10}}>{item.damage} • {item.has_ammo ? `Munição: ${item.ammo_count}` : 'Sem Munição'}</Text>
                                       </View>
                                       <View style={{flexDirection:'row'}}>
                                           <TouchableOpacity onPress={()=>openEditItem(idx)} style={{marginRight:10}}><Ionicons name="pencil" size={18} color="#44aaff" /></TouchableOpacity>
                                           <TouchableOpacity onPress={()=>{const u=[...eventItems];u.splice(idx,1);setEventItems(u)}}><Ionicons name="trash" size={18} color="#ff4444" /></TouchableOpacity>
                                       </View>
                                   </View>
                               ))}
                               <TouchableOpacity onPress={openAddItem} style={[styles.dashedBtn, {borderColor:'#44aaff'}]}><Text style={{color:'#44aaff'}}>+ Adicionar Item</Text></TouchableOpacity>
                           </View> 
                        )}

                        {/* SECÇÃO DE PASSIVAS */}
                        <View style={[styles.checkboxContainer, {marginTop: 15, borderColor: '#9b59b6'}]}>
                            <Text style={styles.checkboxLabel}>Adicionar Passivas Globais?</Text>
                            <Switch value={hasPassives} onValueChange={setHasPassives} trackColor={{false: '#333', true: '#9b59b6'}} thumbColor={'#fff'} />
                        </View>

                        {hasPassives && (
                           <View style={styles.sectionContainer}>
                               <Text style={[styles.sectionTitle, {color:'#9b59b6'}]}>REGRAS E EFEITOS GLOBAIS</Text>
                               {eventPassives.map((p, idx) => (
                                   <View key={idx} style={styles.listItem}>
                                       <View style={{flex:1}}>
                                           <Text style={{color:'#fff', fontWeight:'bold'}}>{p.name}</Text>
                                           <Text style={{color:'#aaa', fontSize:10}}>{p.description}</Text>
                                       </View>
                                       <View style={{flexDirection:'row'}}>
                                           <TouchableOpacity onPress={()=>openEditPassive(idx)} style={{marginRight:10}}><Ionicons name="pencil" size={18} color="#9b59b6" /></TouchableOpacity>
                                           <TouchableOpacity onPress={()=>{const u=[...eventPassives];u.splice(idx,1);setEventPassives(u)}}><Ionicons name="trash" size={18} color="#ff4444" /></TouchableOpacity>
                                       </View>
                                   </View>
                               ))}
                               <TouchableOpacity onPress={openAddPassive} style={[styles.dashedBtn, {borderColor:'#9b59b6'}]}><Text style={{color:'#9b59b6'}}>+ Adicionar Passiva</Text></TouchableOpacity>
                           </View> 
                        )}

                        <View style={{marginTop: 20}}>
                            <TouchableOpacity onPress={handleSaveEvent} style={styles.saveBtn} disabled={saving}>
                                {saving || uploadingImage ? <ActivityIndicator color="#000"/> : <Text style={styles.btnText}>SALVAR EVENTO</Text>}
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setCreateMode(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity>
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            )}

            {/* MODAIS INTERNOS */}
            
            {/* Modal Boss/Inimigo */}
            <Modal transparent visible={createEventCharModalVisible} animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, {height:'auto', maxHeight:'90%'}]}>
                        <ScrollView>
                            <Text style={styles.modalTitle}>Inimigo</Text>
                            <TextInput style={styles.input} placeholder="Nome" value={evCharName} onChangeText={setEvCharName} placeholderTextColor="#555"/>
                            <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}>
                                <View style={{flexDirection:'row', alignItems:'center'}}><Text style={{color:'#fff', marginRight:5}}>Vida?</Text><Switch value={evCharHasLife} onValueChange={setEvCharHasLife}/></View>
                                <View style={{flexDirection:'row', alignItems:'center'}}><Text style={{color:'#fff', marginRight:5}}>É Boss?</Text><Switch value={evCharIsBoss} onValueChange={setEvCharIsBoss}/></View>
                            </View>

                            {/* NOVA CHECKBOX: VIRA BOSS */}
                            <View style={[styles.checkboxContainer, {padding: 10, marginBottom: 10}]}>
                                <Text style={{color:'#fff', fontSize:12, flex:1}}>Vira Boss na condição?</Text>
                                <Switch value={evCharBecomesBoss} onValueChange={setEvCharBecomesBoss} trackColor={{false:'#333', true:'#ff8800'}}/>
                            </View>

                            {evCharHasLife && <TextInput style={styles.input} placeholder="HP" value={evCharHp} onChangeText={setEvCharHp} keyboardType="numeric"/>}
                            
                            <View style={styles.skillForm}>
                                <TextInput style={[styles.input,{marginBottom:5}]} placeholder="Nome Skill" value={skillName} onChangeText={setSkillName} placeholderTextColor="#555"/>
                                <TextInput style={[styles.input,{marginBottom:5}]} placeholder="Desc" value={skillDesc} onChangeText={setSkillDesc} placeholderTextColor="#555"/>
                                <View style={{flexDirection:'row', justifyContent:'space-around', marginBottom:5}}>
                                    <TouchableOpacity onPress={()=>setSkillType('active')}><Text style={{color:skillType==='active'?'#00B37E':'#555'}}>Ativa</Text></TouchableOpacity>
                                    <TouchableOpacity onPress={()=>setSkillType('passive')}><Text style={{color:skillType==='passive'?'#8257e5':'#555'}}>Passiva</Text></TouchableOpacity>
                                    <TouchableOpacity onPress={()=>setSkillType('transformation')}><Text style={{color:skillType==='transformation'?'#FFD700':'#555'}}>Transf</Text></TouchableOpacity>
                                </View>
                                <TouchableOpacity onPress={addEvCharSkill} style={[styles.saveBtn,{padding:10}]}><Text style={{color:'#fff',fontSize:12}}>+ ADD SKILL</Text></TouchableOpacity>
                            </View>
                            {evCharSkills.map((s,i)=>(<View key={i} style={styles.skillRow}><Text style={{color:'#fff',flex:1}}>{s.name}</Text><TouchableOpacity onPress={()=>{const u=[...evCharSkills];u.splice(i,1);setEvCharSkills(u)}}><Ionicons name="trash" size={16} color="red"/></TouchableOpacity></View>))}

                            <TouchableOpacity onPress={saveEventChar} style={[styles.saveBtn,{marginTop:10}]}><Text style={styles.btnText}>SALVAR</Text></TouchableOpacity>
                            <TouchableOpacity onPress={()=>setCreateEventCharModalVisible(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity>
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Modal Facção */}
            <Modal transparent visible={editFactionModalVisible} animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, {height:'auto', maxHeight:'90%'}]}>
                        <Text style={styles.modalTitle}>Editar Facção</Text>
                        <TextInput style={styles.input} value={currentFactionName} onChangeText={setCurrentFactionName}/>
                        <FlatList data={currentFactionSkills} keyExtractor={(i,x)=>`${x}`} renderItem={({item,index})=>(<View style={styles.skillRow}><Text style={{color:'#fff',flex:1}}>R{item.round}: {item.skill.name}</Text><TouchableOpacity onPress={()=>{const u=[...currentFactionSkills];u.splice(index,1);setCurrentFactionSkills(u)}}><Ionicons name="trash" size={16} color="red"/></TouchableOpacity></View>)}/>
                        <TouchableOpacity style={[styles.dashedBtn,{marginTop:10}]} onPress={()=>setSelectFactionSkillModalVisible(true)}><Text style={{color:'#00B37E'}}>+ Add Skill</Text></TouchableOpacity>
                        <TouchableOpacity onPress={saveCurrentFaction} style={[styles.saveBtn,{marginTop:10}]}><Text style={styles.btnText}>SALVAR</Text></TouchableOpacity>
                        <TouchableOpacity onPress={()=>setEditFactionModalVisible(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Modal Skill Facção */}
            <Modal transparent visible={selectFactionSkillModalVisible} animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, {height:'auto'}]}>
                        <Text style={styles.modalTitle}>Nova Skill</Text>
                        <TextInput style={styles.input} placeholder="Volta" value={factionSkillRoundInput} onChangeText={setFactionSkillRoundInput} keyboardType="numeric"/>
                        <TextInput style={styles.input} placeholder="Nome" value={factionSkillName} onChangeText={setFactionSkillName} placeholderTextColor="#555"/>
                        <TextInput style={styles.input} placeholder="Desc" value={factionSkillDesc} onChangeText={setFactionSkillDesc} placeholderTextColor="#555"/>
                        <TouchableOpacity onPress={handleAddFactionSkill} style={styles.saveBtn}><Text style={styles.btnText}>ADICIONAR</Text></TouchableOpacity>
                        <TouchableOpacity onPress={()=>setSelectFactionSkillModalVisible(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* MODAL DE ITEM */}
            <Modal transparent visible={createItemModalVisible} animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, {height:'auto'}]}>
                        <Text style={styles.modalTitle}>Novo Item</Text>
                        <TextInput style={styles.input} placeholder="Nome do Item" value={itemName} onChangeText={setItemName} placeholderTextColor="#555"/>
                        <TextInput style={styles.input} placeholder="Dano (ex: 2d6, 10, Explosão)" value={itemDamage} onChangeText={setItemDamage} placeholderTextColor="#555"/>
                        <TextInput style={[styles.input, {height:60}]} placeholder="Descrição" value={itemDesc} onChangeText={setItemDesc} multiline placeholderTextColor="#555"/>
                        <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:15, backgroundColor:'#222', padding:10, borderRadius:8}}>
                            <Text style={{color:'#fff'}}>Possui Munição?</Text>
                            <Switch value={itemHasAmmo} onValueChange={setItemHasAmmo} trackColor={{false:'#333', true:'#44aaff'}}/>
                        </View>
                        {itemHasAmmo && (
                            <TextInput style={[styles.input, {borderColor:'#44aaff'}]} placeholder="Quantidade de Munição" value={itemAmmoCount} onChangeText={setItemAmmoCount} keyboardType="numeric" placeholderTextColor="#555"/>
                        )}
                        <TouchableOpacity onPress={saveItem} style={[styles.saveBtn, {backgroundColor: '#44aaff'}]}><Text style={styles.btnText}>SALVAR ITEM</Text></TouchableOpacity>
                        <TouchableOpacity onPress={()=>setCreateItemModalVisible(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal>

             {/* MODAL DE PASSIVA */}
             <Modal transparent visible={createPassiveModalVisible} animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, {height:'auto'}]}>
                        <Text style={styles.modalTitle}>Nova Passiva Global</Text>
                        <TextInput style={styles.input} placeholder="Nome (Ex: Chuva Ácida)" value={passiveName} onChangeText={setPassiveName} placeholderTextColor="#555"/>
                        <TextInput style={[styles.input, {height:80}]} placeholder="Descrição do Efeito" value={passiveDesc} onChangeText={setPassiveDesc} multiline placeholderTextColor="#555"/>
                        
                        <TouchableOpacity onPress={savePassive} style={[styles.saveBtn, {backgroundColor: '#9b59b6'}]}><Text style={styles.btnText}>SALVAR PASSIVA</Text></TouchableOpacity>
                        <TouchableOpacity onPress={()=>setCreatePassiveModalVisible(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#18181B', borderRadius: 24, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, alignItems:'center' },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign:'center', marginBottom:15 },
  itemRow: { flexDirection: 'row', padding: 15, borderBottomWidth: 1, borderColor: '#333', alignItems:'center' },
  input: { backgroundColor: '#27272A', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 15, borderWidth:1, borderColor:'#3F3F46' },
  saveBtn: { backgroundColor: '#00875F', padding: 15, borderRadius: 8, alignItems: 'center' },
  cancelBtn: { backgroundColor: '#333', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  actionBtn: { backgroundColor:'#00B37E', padding:10, borderRadius:8, alignItems:'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  imagePickerBtn: { width:'100%', height:120, backgroundColor:'#222', borderRadius:8, alignItems:'center', justifyContent:'center', borderStyle:'dashed', borderWidth:1, borderColor:'#555', marginBottom:20 },
  imagePreview: { width:'100%', height:'100%', borderRadius:8, resizeMode:'cover' },
  sectionContainer: { marginTop:10, borderTopWidth:1, borderTopColor:'#333', paddingTop:10 },
  sectionTitle: { fontSize:14, fontWeight:'bold', marginBottom:10 },
  listItem: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', backgroundColor:'#121214', padding:10, borderRadius:8, marginBottom:5, borderWidth:1, borderColor:'#333' },
  dashedBtn: { alignItems:'center', padding:10, borderStyle:'dashed', borderWidth:1, borderColor:'#555', borderRadius:8, marginTop:5 },
  skillForm: { backgroundColor:'#202024', padding:10, borderRadius:8 },
  skillRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:8, borderBottomWidth:1, borderBottomColor:'#333' },
  
  checkboxContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#222', padding: 15, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#555' },
  checkboxLabel: { color: '#fff', fontWeight: 'bold' }
});