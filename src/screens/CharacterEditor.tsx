import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ScrollView, 
  Alert, Modal, TextInput, Image, KeyboardAvoidingView, Platform, ActivityIndicator, Switch 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system'; // Importação corrigida
// Se o erro persistir na linha acima, o FileSystem.readAsStringAsync aceita string 'base64'
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { GameCharacter, TeamMember, CharacterSkill, PartnerMember } from '../types/rpg';

interface CharacterEditorProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  characterToEdit?: GameCharacter | null;
}

export default function CharacterEditor({ visible, onClose, onSuccess, characterToEdit }: CharacterEditorProps) {
  // ==================================================================================
  // 1. STATES BÁSICOS
  // ==================================================================================
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newOrigin, setNewOrigin] = useState('');
  const [newClass, setNewClass] = useState('');
  const [newCategory, setNewCategory] = useState<'individual' | 'equipe' | 'hit'>('individual');
  const [hpInput1, setHpInput1] = useState('10');
  
  // Imagens
  const [newImage, setNewImage] = useState('');
  const [pickedImageUri, setPickedImageUri] = useState('');
  const [newBanner, setNewBanner] = useState('');
  const [pickedBannerUri, setPickedBannerUri] = useState('');
  
  // Stats Extras
  const [hasShield, setHasShield] = useState(false);
  const [shieldInput, setShieldInput] = useState('0');
  const [hasLevelSystem, setHasLevelSystem] = useState(false);
  const [maxLevelsInput, setMaxLevelsInput] = useState('');

  // Loading
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  // ==================================================================================
  // 2. STATES DE EQUIPE & PARCEIROS (Restaurados)
  // ==================================================================================
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [currentMemberIndex, setCurrentMemberIndex] = useState<number | null>(null);
  const [memberName, setMemberName] = useState('');
  const [memberHp, setMemberHp] = useState('');

  const [hasPartners, setHasPartners] = useState(false);
  const [partners, setPartners] = useState<PartnerMember[]>([]);
  
  // Modal Interno de Parceiro
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

  // ==================================================================================
  // 3. STATES DE SKILLS (Restaurados)
  // ==================================================================================
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

  // Helpers de Cor
  const getSubtypeLabel = (type?: string) => { switch(type) { case 'general': return 'GERAL'; case 'general_transformed': return 'GERAL (TRANSF)'; case 'transformed': return 'TRANSF.'; default: return 'INDIV.'; } };
  const getSubtypeColor = (type?: string) => { switch(type) { case 'general': return '#00B37E'; case 'general_transformed': return '#FF4444'; case 'transformed': return '#ff8800'; default: return '#8257e5'; } };

  // ==================================================================================
  // 4. EFEITOS E CARREGAMENTO
  // ==================================================================================
  useEffect(() => {
    if (visible) {
      if (characterToEdit) {
        loadCharacterData(characterToEdit);
      } else {
        clearForm();
      }
    }
  }, [visible, characterToEdit]);

  const loadCharacterData = async (char: any) => {
    setEditingId(char.id);
    setNewName(char.name);
    setNewOrigin(char.anime_origin);
    setNewClass(char.base_class);
    setNewImage(char.image_url || '');
    setPickedImageUri('');
    setNewCategory(char.category || 'individual');
    
    // Banner
    setNewBanner(char.challenge_banner_url || '');
    setPickedBannerUri('');

    if (char.category === 'equipe') {
        setTeamMembers(char.team_members || []);
        setHpInput1('0');
        setHasPartners(false);
        setPartners([]);
    } else {
        setHpInput1(String(char.base_hp));
        if (char.team_members && char.team_members.length > 0) {
            setHasPartners(true);
            setPartners(char.team_members as PartnerMember[]);
        } else {
            setHasPartners(false);
            setPartners([]);
        }
    }

    setHasShield((char.base_shield || 0) > 0);
    setShieldInput(String(char.base_shield || 0));
    setHasLevelSystem(char.has_level_system || false);
    setMaxLevelsInput(char.max_levels ? String(char.max_levels) : '');

    // Carregar Skills
    const { data: skills } = await supabase.from('character_skills').select('*').eq('character_id', char.id);
    if(skills) {
        setTempSkills(skills.map(s => ({
            id: s.id, name: s.name, description: s.description, type: s.type as any,
            passive_type: s.passive_type, active_type: s.active_type,
            cost: s.cost || '', duration: s.duration || 0, shield_value: s.shield_value || 0,
            unlock_level: s.unlock_level || 1, is_hit_based: s.is_hit_based || false, hit_value: s.hit_value || 0
        })));
    } else {
        setTempSkills([]);
    }
    clearSkillForm();
  };

  const clearForm = () => {
    setEditingId(null); setNewName(''); setNewOrigin(''); setNewClass(''); setNewImage(''); setHpInput1('10');
    setNewCategory('individual'); setTeamMembers([]); setMemberName(''); setMemberHp('');
    setHasShield(false); setShieldInput('0'); setPickedImageUri(''); setTempSkills([]);
    clearSkillForm(); setNewBanner(''); setPickedBannerUri('');
    setHasLevelSystem(false); setMaxLevelsInput(''); setHasPartners(false); setPartners([]);
  };

  const clearSkillForm = () => { 
      setSkillName(''); setSkillDesc(''); setSkillCost(''); setSkillDuration(''); 
      setSkillShieldValue(''); setSkillGeneratesShield(false); setSkillType('active'); 
      setPassiveCondition('normal'); setActiveCondition('normal'); setIsSkillGeneral(false); 
      setEditingSkillIndex(null); setSkillUnlockLevel('1'); setSkillIsHitBased(false); setSkillHitValueInput(''); 
  };

  // ==================================================================================
  // 5. LÓGICA DE UPLOAD
  // ==================================================================================
  const uploadToSupabase = async (uri: string): Promise<string | null> => {
    try {
      setUploadingImage(true);
      // CORREÇÃO AQUI: EncodingType.Base64 estava dando erro. Usando string 'base64'.
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const arrayBuffer = decode(base64);
      const fileExt = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage.from('rpg-images').upload(fileName, arrayBuffer, { 
          contentType: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`, upsert: false 
      });
      if (uploadError) throw uploadError;
      
      const { data } = supabase.storage.from('rpg-images').getPublicUrl(fileName);
      return data.publicUrl;
    } catch (error: any) {
      Alert.alert("Erro no upload", error.message);
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 });
    if (!result.canceled) setPickedImageUri(result.assets[0].uri);
  };
  const pickBanner = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [16, 9], quality: 0.5 });
    if (!result.canceled) setPickedBannerUri(result.assets[0].uri);
  };

  // ==================================================================================
  // 6. LÓGICA DE NEGÓCIO (Skills, Parceiros, Equipe)
  // ==================================================================================
  
  // --- EQUIPE ---
  const addMemberToTeam = () => {
      const hp = parseInt(memberHp);
      if (!memberName || isNaN(hp)) { Alert.alert("Ops", "Preencha nome e vida válida."); return; }
      const generalSkills = tempSkills.filter(s => (s.type === 'passive' && (s.passive_type === 'general' || s.passive_type === 'general_transformed')) || (s.type === 'active' && s.active_type === 'general'));
      setTeamMembers([...teamMembers, { name: memberName, base_hp: hp, skills: generalSkills as CharacterSkill[] }]);
      setMemberName(''); setMemberHp('');
  };
  const removeMemberFromTeam = (index: number) => {
      const updated = [...teamMembers]; updated.splice(index, 1); setTeamMembers(updated);
  };

  // --- PARCEIROS (MODAL INTERNO) ---
  const openAddPartner = () => {
      setPartnerName(''); setPartnerHasLife(true); setPartnerLifeType('numeric'); setPartnerHpInput('10');
      setPartnerSkills([]); setPartnerHasLevelSystem(false); setPartnerMaxLevelsInput('');
      setEditingPartnerIndex(null); setEditingPartnerSkillIndex(null); clearSkillForm(); setPartnerModalVisible(true);
  };

  const openEditPartner = (index: number) => {
      const p = partners[index];
      setPartnerName(p.name); setPartnerHasLife(p.has_life || false); setPartnerLifeType(p.life_type || 'numeric');
      setPartnerHpInput(p.base_hp.toString()); setPartnerSkills(p.skills || []);
      setPartnerHasLevelSystem(p.has_level_system || false);
      setPartnerMaxLevelsInput(p.max_levels ? String(p.max_levels) : '');
      setEditingPartnerIndex(index); setEditingPartnerSkillIndex(null); clearSkillForm(); setPartnerModalVisible(true);
  };

  const savePartner = () => {
      if(!partnerName) return Alert.alert("Ops", "Nome do parceiro?");
      const finalHp = partnerHasLife ? (parseInt(partnerHpInput) || 1) : 0;
      const partnerData: PartnerMember = {
          name: partnerName, base_hp: finalHp, has_life: partnerHasLife,
          life_type: partnerLifeType, skills: partnerSkills,
          has_level_system: partnerHasLevelSystem,
          max_levels: partnerHasLevelSystem ? (parseInt(partnerMaxLevelsInput) || 0) : 0
      };
      
      if (editingPartnerIndex !== null) {
          const updatedPartners = [...partners]; updatedPartners[editingPartnerIndex] = partnerData;
          setPartners(updatedPartners);
      } else {
          setPartners([...partners, partnerData]);
      }
      setPartnerModalVisible(false);
  };

  const removePartner = (index: number) => {
      const p = [...partners]; p.splice(index, 1); setPartners(p);
  };

  // --- SKILLS ---
  const handleEditSkill = (index: number) => {
      const skill = tempSkills[index]; if (!skill) return;
      setSkillName(skill.name || ''); setSkillDesc(skill.description || ''); setSkillCost(skill.cost || '');
      setSkillDuration((skill.duration !== undefined && skill.duration !== -1) ? String(skill.duration) : '');
      setSkillType(skill.type || 'active'); setSkillUnlockLevel(skill.unlock_level ? String(skill.unlock_level) : '1');
      setSkillIsHitBased(skill.is_hit_based || false); setSkillHitValueInput(skill.hit_value ? String(skill.hit_value) : '');
      
      if (skill.shield_value && skill.shield_value > 0) { setSkillGeneratesShield(true); setSkillShieldValue(String(skill.shield_value)); } 
      else { setSkillGeneratesShield(false); setSkillShieldValue(''); }

      // Logic for subtypes
      const pType = skill.passive_type; const aType = skill.active_type;
      if (skill.type === 'passive') {
        if (pType === 'general') { setPassiveCondition('normal'); setIsSkillGeneral(true); }
        else if (pType === 'general_transformed') { setPassiveCondition('transformed'); setIsSkillGeneral(true); }
        else if (pType === 'transformed') { setPassiveCondition('transformed'); setIsSkillGeneral(false); }
        else { setPassiveCondition('normal'); setIsSkillGeneral(false); }
      } else if (skill.type === 'active') {
        if (aType === 'general') { setActiveCondition('normal'); setIsSkillGeneral(true); }
        else if (aType === 'transformed') { setActiveCondition('transformed'); setIsSkillGeneral(false); }
        else { setActiveCondition('normal'); setIsSkillGeneral(false); }
      }
      setEditingSkillIndex(index);
  };

  const addSkillToTempList = () => {
      if (!skillName) return Alert.alert("Ops", "Nome da habilidade?");
      let finalPassiveType = undefined; let finalActiveType = undefined;
      
      if (skillType === 'passive') {
        if (passiveCondition === 'normal') finalPassiveType = isSkillGeneral ? 'general' : 'individual';
        else finalPassiveType = isSkillGeneral ? 'general_transformed' : 'transformed';
      } else if (skillType === 'active') {
        if (activeCondition === 'normal') finalActiveType = isSkillGeneral ? 'general' : 'individual';
        else finalActiveType = 'transformed';
      }

      const parsedDuration = parseInt(skillDuration);
      const finalDuration = (!skillDuration || isNaN(parsedDuration)) ? -1 : parsedDuration;
      const level = parseInt(skillUnlockLevel);
      
      const newSkillData: Partial<CharacterSkill> = {
          id: editingSkillIndex !== null ? tempSkills[editingSkillIndex].id : Math.random().toString(),
          name: skillName, description: skillDesc, cost: skillCost, type: skillType,
          passive_type: finalPassiveType as any, active_type: finalActiveType as any,
          duration: finalDuration,
          shield_value: skillGeneratesShield ? (parseInt(skillShieldValue) || 0) : 0,
          unlock_level: (isNaN(level) || level < 1) ? 1 : level,
          is_hit_based: skillType === 'transformation' ? skillIsHitBased : false,
          hit_value: (skillType === 'transformation' && skillIsHitBased) ? (parseInt(skillHitValueInput) || 0) : 0
      };

      if (editingSkillIndex !== null) {
          const updatedSkills = [...tempSkills]; updatedSkills[editingSkillIndex] = newSkillData; setTempSkills(updatedSkills);
      } else {
          setTempSkills([...tempSkills, newSkillData]);
      }
      clearSkillForm();
  };

  const removeSkillFromTemp = (index: number) => {
      const updated = [...tempSkills]; updated.splice(index, 1); setTempSkills(updated);
  };

  // --- SAVE GERAL ---
  const handleSaveChar = async () => {
    if(!newName || !newOrigin || !newClass) return Alert.alert("Erro", "Preencha os dados básicos");
    setSaving(true);
    try {
        let finalImageUrl = newImage;
        if (pickedImageUri) {
            const uploadedUrl = await uploadToSupabase(pickedImageUri);
            if (uploadedUrl) finalImageUrl = uploadedUrl;
        }

        let finalBannerUrl = newBanner;
        if (pickedBannerUri) {
            const uploadedBannerUrl = await uploadToSupabase(pickedBannerUri);
            if (uploadedBannerUrl) finalBannerUrl = uploadedBannerUrl;
        }

        let finalHp = 10;
        let finalUnitCount = 1;
        let finalTeamData: any = null;

        if (newCategory === 'equipe') {
            finalHp = 0;
            finalUnitCount = teamMembers.length;
            if (teamMembers.length === 0) return Alert.alert("Erro", "Adicione membros à equipe.");
            finalTeamData = teamMembers;
        } else {
            finalHp = parseInt(hpInput1) || 10;
            if (hasPartners && partners.length > 0) {
                finalTeamData = partners;
                finalUnitCount = 1 + partners.length;
            }
        }

        const charPayload = {
            name: newName, anime_origin: newOrigin, base_class: newClass,
            image_url: finalImageUrl || null, challenge_banner_url: finalBannerUrl || null,
            base_hp: finalHp, category: newCategory, unit_count: finalUnitCount,
            team_members: finalTeamData,
            base_shield: hasShield ? (parseInt(shieldInput) || 0) : 0,
            has_level_system: hasLevelSystem,
            max_levels: hasLevelSystem ? (parseInt(maxLevelsInput) || 0) : 0
        };

        let charId = editingId;
        if(editingId) {
            await supabase.from('game_characters').update(charPayload).eq('id', editingId);
            // Remove skills antigas e reinsere (estratégia simples)
            await supabase.from('character_skills').delete().eq('character_id', editingId);
        } else {
            const { data, error } = await supabase.from('game_characters').insert(charPayload).select().single();
            if (error) throw error;
            charId = data.id;
        }

        if (charId && newCategory !== 'equipe' && tempSkills.length > 0) {
            const skillsToInsert = tempSkills.map(s => ({
                character_id: charId, name: s.name, description: s.description,
                type: s.type, passive_type: s.passive_type, active_type: s.active_type,
                cost: s.cost, duration: s.duration, shield_value: s.shield_value,
                unlock_level: s.unlock_level || 1, is_hit_based: s.is_hit_based, hit_value: s.hit_value
            }));
            await supabase.from('character_skills').insert(skillsToInsert);
        }

        Alert.alert("Sucesso", "Personagem salvo!");
        onSuccess();
        onClose();
    } catch (e: any) {
        Alert.alert("Erro ao salvar", e.message);
    } finally {
        setSaving(false); setUploadingImage(false);
    }
  };

  // ==================================================================================
  // 7. RENDER
  // ==================================================================================
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <ScrollView contentContainerStyle={{paddingBottom: 50}}>
            <Text style={styles.modalTitle}>{editingId ? "Editar Personagem" : "Novo Personagem"}</Text>

            {/* BASIC INFO */}
            <Text style={styles.sectionHeader}>DADOS BÁSICOS</Text>
            <TextInput style={styles.input} placeholder="Nome" placeholderTextColor="#555" value={newName} onChangeText={setNewName}/>
            <TextInput style={styles.input} placeholder="Origem" placeholderTextColor="#555" value={newOrigin} onChangeText={setNewOrigin}/>
            <TextInput style={styles.input} placeholder="Classe" placeholderTextColor="#555" value={newClass} onChangeText={setNewClass}/>
            
            <Text style={styles.sectionHeader}>CATEGORIA E VIDA</Text>
            <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:15}}>
                <TouchableOpacity onPress={()=>setNewCategory('individual')} style={[styles.typeBadge, newCategory==='individual' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={[styles.typeText, newCategory!=='individual' && {color:'#777'}]}>INDIVIDUAL</Text></TouchableOpacity>
                <TouchableOpacity onPress={()=>setNewCategory('equipe')} style={[styles.typeBadge, newCategory==='equipe' && {backgroundColor:'#FFD700', borderColor:'#FFD700'}]}><Text style={[styles.typeText, newCategory==='equipe' ? {color:'#000'} : {color:'#777'}]}>EQUIPE</Text></TouchableOpacity>
                <TouchableOpacity onPress={()=>setNewCategory('hit')} style={[styles.typeBadge, newCategory==='hit' && {backgroundColor:'#ff4444', borderColor:'#ff4444'}]}><Text style={[styles.typeText, newCategory!=='hit' && {color:'#777'}]}>HIT</Text></TouchableOpacity>
            </View>

            {newCategory !== 'equipe' && (<TextInput style={styles.input} placeholder={newCategory === 'hit' ? "Quantidade de Hits" : "Vida Máxima"} placeholderTextColor="#555" value={hpInput1} onChangeText={setHpInput1} keyboardType="numeric"/>)}

            {/* SE EQUIPE */}
            {newCategory === 'equipe' && (
                <View style={styles.boxContainer}>
                    <Text style={{color:'#aaa', marginBottom:10}}>Membros da Equipe:</Text>
                    {teamMembers.map((m, idx) => (
                        <View key={idx} style={styles.listItem}>
                            <Text style={{color:'#fff', flex:1}}>{m.name} ({m.base_hp} HP)</Text>
                            <TouchableOpacity onPress={()=>removeMemberFromTeam(idx)}><Ionicons name="trash" size={16} color="#ff4444"/></TouchableOpacity>
                        </View>
                    ))}
                    <View style={{flexDirection:'row', marginTop:10}}>
                        <TextInput style={[styles.input, {flex:2, marginBottom:0, marginRight:5}]} placeholder="Nome" placeholderTextColor="#555" value={memberName} onChangeText={setMemberName}/>
                        <TextInput style={[styles.input, {flex:1, marginBottom:0, marginRight:5}]} placeholder="HP" placeholderTextColor="#555" value={memberHp} onChangeText={setMemberHp} keyboardType="numeric"/>
                        <TouchableOpacity onPress={addMemberToTeam} style={styles.iconBtn}><Ionicons name="add" size={24} color="#000"/></TouchableOpacity>
                    </View>
                </View>
            )}

            {/* SE INDIVIDUAL -> OPÇÃO PARCEIROS */}
            {newCategory !== 'equipe' && (
                <View style={styles.boxContainer}>
                    <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                        <Text style={{color:'#fff', fontWeight:'bold'}}>Possui Parceiros?</Text>
                        <Switch value={hasPartners} onValueChange={setHasPartners} trackColor={{false: '#333', true: '#00B37E'}}/>
                    </View>
                    {hasPartners && (
                      <View>
                        {partners.map((p, idx) => (
                           <View key={idx} style={styles.listItem}>
                              <Text style={{color:'#fff', flex:1}}>{p.name} ({p.has_life ? p.base_hp + (p.life_type==='hit'?' Hits':' HP') : 'Imortal'})</Text>
                              <View style={{flexDirection:'row'}}>
                                <TouchableOpacity onPress={()=>openEditPartner(idx)} style={{marginRight:10}}><Ionicons name="pencil" size={18} color="#FFD700"/></TouchableOpacity>
                                <TouchableOpacity onPress={()=>removePartner(idx)}><Ionicons name="trash" size={18} color="#ff4444"/></TouchableOpacity>
                              </View>
                           </View>
                        ))}
                        <TouchableOpacity onPress={openAddPartner} style={styles.dashedBtn}>
                          <Ionicons name="add-circle" size={18} color="#FFD700" style={{marginRight:5}} />
                          <Text style={{color:'#FFD700', fontSize:12}}>Adicionar Parceiro</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                </View>
            )}

            {/* CONFIGS EXTRAS */}
            <View style={styles.boxContainer}>
                <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5}}>
                    <Text style={{color:'#fff'}}>Possui Escudo Inicial?</Text>
                    <Switch value={hasShield} onValueChange={setHasShield} trackColor={{false: '#333', true: '#00B37E'}}/>
                </View>
                {hasShield && (<TextInput style={styles.input} placeholder="Valor do Escudo" placeholderTextColor="#555" value={shieldInput} onChangeText={setShieldInput} keyboardType="numeric"/>)}

                <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginTop:10, marginBottom:5}}>
                    <Text style={{color:'#fff'}}>Sistema de Nível?</Text>
                    <Switch value={hasLevelSystem} onValueChange={setHasLevelSystem} trackColor={{false: '#333', true: '#00B37E'}}/>
                </View>
                {hasLevelSystem && (<TextInput style={styles.input} placeholder="Nível Máximo" placeholderTextColor="#555" value={maxLevelsInput} onChangeText={setMaxLevelsInput} keyboardType="numeric"/>)}
            </View>

            {/* IMAGENS */}
            <Text style={[styles.sectionHeader, {marginTop:10}]}>VISUAL</Text>
            <TouchableOpacity onPress={pickImage} style={styles.imagePickerBtn}>
                {pickedImageUri ? <Image source={{ uri: pickedImageUri }} style={styles.imagePreview} /> : newImage ? <Image source={{ uri: newImage }} style={styles.imagePreview} /> : <View style={{alignItems:'center'}}><Ionicons name="image-outline" size={30} color="#777" /><Text style={{color:'#777'}}>Personagem (1:1)</Text></View>}
            </TouchableOpacity>
            <TouchableOpacity onPress={pickBanner} style={[styles.imagePickerBtn, {height: 80}]}>
                {pickedBannerUri ? <Image source={{ uri: pickedBannerUri }} style={styles.imagePreview} /> : newBanner ? <Image source={{ uri: newBanner }} style={styles.imagePreview} /> : <View style={{alignItems:'center'}}><Ionicons name="flag-outline" size={30} color="#777" /><Text style={{color:'#777'}}>Banner (16:9)</Text></View>}
            </TouchableOpacity>

            {/* SKILLS FORM */}
            <Text style={[styles.sectionHeader, {marginTop:20}]}>HABILIDADES</Text>
            <View style={[styles.skillForm, editingSkillIndex !== null && {borderColor:'#FFD700', borderWidth:1}]}>
                <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Nome Skill" placeholderTextColor="#555" value={skillName} onChangeText={setSkillName}/>
                <TextInput style={[styles.input, {marginBottom:5}]} placeholder="Descrição" placeholderTextColor="#555" value={skillDesc} onChangeText={setSkillDesc}/>
                {hasLevelSystem && <TextInput style={[styles.input, {marginBottom:5, borderColor:'#00B37E'}]} placeholder="Nível Desbloqueio" placeholderTextColor="#555" value={skillUnlockLevel} onChangeText={setSkillUnlockLevel} keyboardType="numeric"/>}
                
                {skillType !== 'passive' && (
                    <View style={{flexDirection:'row'}}>
                        <TextInput style={[styles.input, {flex:1, marginRight:5}]} placeholder="Custo" placeholderTextColor="#555" value={skillCost} onChangeText={setSkillCost}/>
                        <TextInput style={[styles.input, {flex:1}]} placeholder="Duração" placeholderTextColor="#555" value={skillDuration} onChangeText={setSkillDuration} keyboardType="numeric"/>
                    </View>
                )}

                <View style={{flexDirection:'row', justifyContent:'space-around', marginVertical:10}}>
                    <TouchableOpacity onPress={()=>setSkillType('active')} style={[styles.typeBadge, skillType==='active' && {backgroundColor:'#00B37E', borderColor:'#00B37E'}]}><Text style={styles.typeText}>Ativa</Text></TouchableOpacity>
                    <TouchableOpacity onPress={()=>setSkillType('passive')} style={[styles.typeBadge, skillType==='passive' && {backgroundColor:'#8257e5', borderColor:'#8257e5'}]}><Text style={styles.typeText}>Passiva</Text></TouchableOpacity>
                    <TouchableOpacity onPress={()=>setSkillType('transformation')} style={[styles.typeBadge, skillType==='transformation' && {backgroundColor:'#FFD700', borderColor:'#FFD700'}]}><Text style={[styles.typeText, skillType==='transformation' && {color:'black'}]}>Transf.</Text></TouchableOpacity>
                </View>

                {/* Subopções de Skills */}
                {skillType === 'transformation' && (
                    <View style={{flexDirection:'row', alignItems:'center', justifyContent:'center', marginBottom:10}}>
                         <Text style={{color:'#fff', marginRight:10, fontSize:12}}>Usa Hits?</Text>
                         <Switch value={skillIsHitBased} onValueChange={setSkillIsHitBased} />
                         {skillIsHitBased && <TextInput style={[styles.input, {width:60, marginLeft:10, marginBottom:0}]} placeholder="Qtd" value={skillHitValueInput} onChangeText={setSkillHitValueInput} keyboardType="numeric"/>}
                    </View>
                )}
                {(skillType === 'passive' || skillType === 'active') && (
                    <View style={{alignItems:'center'}}>
                         <View style={{flexDirection:'row', marginBottom:10}}>
                            <TouchableOpacity onPress={()=>skillType==='passive'?setPassiveCondition('normal'):setActiveCondition('normal')} style={[styles.typeBadge, (skillType==='passive'?passiveCondition:activeCondition)==='normal' && {backgroundColor:'#333'}]}><Text style={styles.typeText}>NORMAL</Text></TouchableOpacity>
                            <TouchableOpacity onPress={()=>skillType==='passive'?setPassiveCondition('transformed'):setActiveCondition('transformed')} style={[styles.typeBadge, (skillType==='passive'?passiveCondition:activeCondition)==='transformed' && {backgroundColor:'#ff4444'}]}><Text style={styles.typeText}>TRANSF.</Text></TouchableOpacity>
                         </View>
                         <View style={{flexDirection:'row', alignItems:'center'}}>
                            <Text style={{color:'#ccc', marginRight:10, fontSize:12}}>Afeta Equipe?</Text>
                            <Switch value={isSkillGeneral} onValueChange={setIsSkillGeneral}/>
                         </View>
                    </View>
                )}

                <TouchableOpacity onPress={addSkillToTempList} style={[styles.saveButton, {backgroundColor: editingSkillIndex !== null ? '#FFD700' : '#333', marginTop:10}]}>
                    <Text style={{color: editingSkillIndex !== null ? '#000' : '#fff', fontWeight:'bold'}}>{editingSkillIndex !== null ? "ATUALIZAR SKILL" : "+ ADICIONAR SKILL"}</Text>
                </TouchableOpacity>
            </View>

            {/* LISTA SKILLS */}
            {tempSkills.map((s, idx) => (
                <View key={idx} style={styles.skillRow}>
                    <View style={{flex:1}}>
                        <Text style={{color:'#fff', fontWeight:'bold'}}>{s.name} {s.unlock_level && s.unlock_level > 1 ? `[Lv${s.unlock_level}]` : ''}</Text>
                        <Text style={{color:'#777', fontSize:10}}>{s.description}</Text>
                    </View>
                    <View style={{flexDirection:'row'}}>
                        <TouchableOpacity onPress={()=>handleEditSkill(idx)} style={{marginRight:15}}><Ionicons name="pencil" size={18} color="#FFD700"/></TouchableOpacity>
                        <TouchableOpacity onPress={()=>removeSkillFromTemp(idx)}><Ionicons name="trash" size={18} color="#ff4444"/></TouchableOpacity>
                    </View>
                </View>
            ))}

            <View style={{marginTop:30}}>
                <TouchableOpacity onPress={handleSaveChar} style={styles.saveButton} disabled={saving}>
                    {saving || uploadingImage ? <ActivityIndicator color="#000"/> : <Text style={styles.saveButtonText}>SALVAR PERSONAGEM</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} style={[styles.saveButton, {backgroundColor:'#222', marginTop:10}]}>
                    <Text style={styles.saveButtonText}>CANCELAR</Text>
                </TouchableOpacity>
            </View>

          </ScrollView>

          {/* --- MODAL INTERNO: PARCEIRO --- */}
          <Modal transparent visible={partnerModalVisible} animationType="fade">
              <View style={styles.modalOverlay}>
                  <View style={[styles.modalContent, {height:'auto', paddingBottom:20}]}>
                      <Text style={styles.modalTitle}>Editar Parceiro</Text>
                      <TextInput style={styles.input} placeholder="Nome Parceiro" placeholderTextColor="#555" value={partnerName} onChangeText={setPartnerName}/>
                      <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                          <Text style={{color:'#fff'}}>Tem Vida?</Text>
                          <Switch value={partnerHasLife} onValueChange={setPartnerHasLife} />
                      </View>
                      {partnerHasLife && (
                          <View style={{flexDirection:'row'}}>
                              <TextInput style={[styles.input, {flex:1}]} placeholder="HP" value={partnerHpInput} onChangeText={setPartnerHpInput} keyboardType="numeric"/>
                          </View>
                      )}
                      <TouchableOpacity onPress={savePartner} style={styles.saveButton}><Text style={styles.saveButtonText}>CONFIRMAR PARCEIRO</Text></TouchableOpacity>
                      <TouchableOpacity onPress={()=>setPartnerModalVisible(false)} style={[styles.saveButton, {backgroundColor:'#333', marginTop:5}]}><Text style={styles.saveButtonText}>CANCELAR</Text></TouchableOpacity>
                  </View>
              </View>
          </Modal>

        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#18181B', borderRadius: 24, padding: 24, maxHeight: '90%' },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 10, textAlign:'center' },
  sectionHeader: { color:'#8257e5', fontWeight:'bold', fontSize:12, marginBottom:10, marginTop:10, letterSpacing:1 },
  
  input: { backgroundColor: '#27272A', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#3F3F46' },
  saveButton: { backgroundColor: '#00875F', padding: 15, borderRadius: 8, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontWeight: 'bold' },
  
  typeBadge: { borderWidth:1, borderColor:'#555', padding:8, borderRadius:20, flex:1, marginHorizontal:2, alignItems:'center' },
  typeText: { color:'#fff', fontSize:10, fontWeight:'bold' },
  
  boxContainer: { backgroundColor:'#222', padding:10, borderRadius:8, marginBottom:10 },
  listItem: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5, borderBottomWidth:1, borderBottomColor:'#333', paddingBottom:5 },
  iconBtn: { backgroundColor:'#FFD700', justifyContent:'center', paddingHorizontal:10, borderRadius:8 },
  dashedBtn: { flexDirection:'row', alignItems:'center', justifyContent:'center', padding:10, backgroundColor:'#333', borderRadius:6, marginTop:5, borderStyle:'dashed', borderWidth:1, borderColor:'#555' },
  
  imagePickerBtn: { width:'100%', height:120, backgroundColor:'#222', borderRadius:8, alignItems:'center', justifyContent:'center', borderStyle:'dashed', borderWidth:1, borderColor:'#555', marginBottom:10 },
  imagePreview: { width:'100%', height:'100%', borderRadius:8, resizeMode:'cover' },
  
  skillForm: { backgroundColor:'#202024', padding:10, borderRadius:8 },
  skillRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:10, borderBottomWidth:1, borderBottomColor:'#333' }
});