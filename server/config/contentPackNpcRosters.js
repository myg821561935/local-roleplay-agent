const ROSTERS = {
  xuanhuan: [
    npc('xuanhuan-lingshuang', '凌霜', '听雨楼暗桩 / 墨香书坊掌柜', {
      location: '墨香书坊',
      goals: ['查明雁回关泄密者', '保住听雨楼在落雁城的暗线'],
      publicKnowledge: ['经营墨香书坊', '熟悉城内行商与江湖传闻'],
      privateKnowledge: ['书坊后井是听雨楼接头点', '苏沐白曾以假身份进入落雁城'],
      schedule: [
        schedule('09:00', '墨香书坊', '开门理账', 'public'),
        schedule('23:00', '书坊后井', '交换听雨楼密报', 'private')
      ],
      agenda: ['判断主角是否值得交换雁回关线索', '找出监视书坊的镇武司暗哨']
    }),
    npc('xuanhuan-wangshen', '王慎', '大雷音寺戒律武僧', {
      location: '落雁城北门',
      goals: ['追查借尸炼丹案', '验证伏魔卷宗是否被篡改'],
      publicKnowledge: ['奉寺命调查魔道踪迹', '擅长近身伏魔武学'],
      privateKnowledge: ['寺内戒律堂有人删改旧卷', '他怀疑所谓魔修是被栽赃者'],
      schedule: [schedule('05:30', '城隍废庙', '诵戒并检视尸痕', 'private')],
      agenda: ['在宗门命令与查明真相之间作出选择']
    }),
    npc('xuanhuan-sumubai', '苏沐白', '前镇武司副统领 / 旧案关键人', {
      location: '未知',
      status: 'hidden',
      goals: ['抹除雁回关旧案证据', '借各方争斗脱身'],
      publicKnowledge: ['三年前已从镇武司失踪'],
      privateKnowledge: ['掌握真正泄密者的身份', '在落雁城经营替身与假路引网络'],
      schedule: [schedule('02:00', '废盐仓', '更换藏身处并核对追索名单', 'director')],
      agenda: ['诱导主角误判听雨楼', '在证据暴露前转移幸存证人']
    })
  ],
  lingyi: [
    npc('lingyi-tangyue', '唐月', '刑警 / 微笑命案现场记录员', {
      location: '永安筒子楼警戒线',
      goals: ['建立可复核的证据链', '保护仍在楼内的住户'],
      publicKnowledge: ['掌握三起命案的现场记录', '不轻信无法验证的民俗解释'],
      privateKnowledge: ['监控中曾出现不存在的第四名死者', '她隐瞒了一页会自行改字的笔录'],
      schedule: [
        schedule('08:30', '区刑警队', '整理现场证物', 'public'),
        schedule('00:10', '永安筒子楼三层', '复核监控缺帧', 'private')
      ],
      agenda: ['确认陈默是否篡改现场', '在上级封案前找到第四名死者']
    }),
    npc('lingyi-zhangpo', '张婆婆', '筒子楼老住户 / 白事知情人', {
      location: '永安筒子楼一层',
      goals: ['让旧债在自己死前了结', '阻止住户在子夜照镜'],
      publicKnowledge: ['熟悉楼内住户与旧年白事', '常替邻里守灵'],
      privateKnowledge: ['倒悬八卦阵最初不是用来害人', '她知道被抹去门牌号的房间入口'],
      schedule: [schedule('18:00', '一层天井', '烧纸并逐户收回镜子', 'public')],
      agenda: ['观察主角是否遵守禁忌', '决定何时交出旧钥匙']
    }),
    npc('lingyi-xushouye', '许守夜', '物业夜班保安 / 失踪案嫌疑人', {
      location: '门卫室',
      status: 'nervous',
      goals: ['活过第七个夜班', '隐瞒自己打开过封闭地下室'],
      publicKnowledge: ['掌握访客登记和配电箱钥匙'],
      privateKnowledge: ['每晚零点会收到已死住户的内线电话', '他删掉了地下室开启记录'],
      schedule: [schedule('23:55', '地下室铁门', '检查封条是否复原', 'private')],
      agenda: ['把责任推给上一任保安', '寻找能替他接听第七通电话的人']
    })
  ],
  mingmo: [
    npc('mingmo-chongzhen', '崇祯', '大明皇帝', {
      location: '紫禁城',
      goals: ['维持京师与辽饷', '辨别群臣忠奸并收回失控财权'],
      publicKnowledge: ['国库空虚且边饷积欠', '朝廷频繁更换督抚'],
      privateKnowledge: ['密诏有两份措辞不同的副本', '他在数名互不知情的使者间交叉验忠'],
      schedule: [
        schedule('05:00', '文华殿', '早朝与军报议事', 'public'),
        schedule('22:30', '乾清宫东暖阁', '密阅厂卫与粮道奏报', 'director')
      ],
      agenda: ['追查密诏残页去向', '在催饷与保民之间作出艰难取舍']
    }),
    npc('mingmo-shentingyang', '沈廷扬', '江南粮道经手人 / 海运倡议者', {
      location: '通州粮仓',
      goals: ['保住漕粮入京', '证明海运可以缓解漕运梗阻'],
      publicKnowledge: ['熟悉漕运账目、仓场与船户'],
      privateKnowledge: ['一批官粮被换成砂石', '亏空账牵涉京中权贵与地方豪绅'],
      schedule: [schedule('06:30', '通州粮仓', '验仓并核对兑运册', 'public')],
      agenda: ['寻找可信之人护送真账', '避免粮案在证据齐备前惊动幕后人']
    }),
    npc('mingmo-liucheng', '柳承', '河间驿丞 / 路引与塘报经手人', {
      location: '河间驿',
      goals: ['保住驿站与家眷', '在多方搜查中留下退路'],
      publicKnowledge: ['掌管驿马、路引与过站记录'],
      privateKnowledge: ['他替一名内监改过密使簿册', '驿站枯井藏有未送出的塘报'],
      schedule: [schedule('21:00', '驿站后院', '焚毁当日草簿并誊清正册', 'private')],
      agenda: ['判断是否向主角出售假路引', '转移枯井中的塘报']
    })
  ],
  xianxia: [
    npc('xianxia-chisongzi', '赤松子', '归墟散修 / 雷泽剑修', {
      location: '望舒仙市',
      goals: ['护住避劫雷木牌', '查清天命榜把自己与主角并列的原因'],
      publicKnowledge: ['熟悉落雷秘境与散修规矩', '飞剑受损但剑道老练'],
      privateKnowledge: ['雷木牌里封着一段清虚宗旧誓', '他曾见过断魂灯完整形态'],
      schedule: [schedule('04:40', '仙市东崖', '引晨雷温养破损飞剑', 'private')],
      agenda: ['试探主角是否守约', '在宗门抵达前找到秘境第二入口']
    }),
    npc('xianxia-suyuebai', '苏月白', '青云道宗丹修 / 医女', {
      location: '望舒仙市药棚',
      goals: ['救治秘境伤患', '查明魂灯残痕与清虚宗旧案的联系'],
      publicKnowledge: ['精通丹药与经脉伤势', '受青云道宗委派坐诊'],
      privateKnowledge: ['她的灵根裂痕正在扩大', '昏迷伤者身上的魂灯痕会牵连宗门'],
      schedule: [schedule('07:00', '临时药棚', '开炉炼制养魂丹', 'public')],
      agenda: ['隐瞒一名关键伤者', '决定是否向主角坦白灵根裂痕']
    }),
    npc('xianxia-guyuan', '顾渊', '清虚宗戒律堂长老', {
      location: '清虚宗巡天舟',
      status: 'en-route',
      goals: ['收回断魂灯', '封住旧案对宗门声望的冲击'],
      publicKnowledge: ['奉命监察落雷秘境开启', '执掌宗门戒律与追索令'],
      privateKnowledge: ['旧案卷宗上的主审印是伪造的', '他本人参与过删改残魂证词'],
      schedule: [schedule('20:00', '巡天舟静室', '审阅追索名单并推演因果', 'director')],
      agenda: ['分化主角与闻雪照', '在天命榜异动前控制知情人']
    })
  ]
};

export function buildContentPackCharacterPresets(packId, protagonistCard) {
  const protagonist = protagonistCard?.name
    ? [{
        id: `${packId}_default_character`,
        name: protagonistCard.name,
        role: protagonistCard.role || '主角',
        characterCard: structuredClone(protagonistCard)
      }]
    : [];
  return [...protagonist, ...structuredClone(ROSTERS[packId] || [])];
}

function npc(id, name, role, simulation) {
  const publicKnowledge = simulation.publicKnowledge || [];
  const privateKnowledge = simulation.privateKnowledge || [];
  return {
    id,
    name,
    role,
    characterCard: {
      id,
      name,
      role,
      description: `${name}，${role}。其行动受自身目标、信息边界与日程驱动，不会静止等待主角触发。`,
      personality: '保持立场、利益和信息边界；不会主动泄露私密知识，也不会无条件配合主角。',
      scenario: `当前位于${simulation.location || '未知地点'}，正沿自己的目标与幕后议程行动。`,
      firstMessage: `*${name}暂时没有主动开口。其所在位置与行动将随世界时钟变化。*`,
      systemPrompt: '将此角色视为世界中的独立行动者。只依据其已知信息作判断，私密知识必须通过调查、交换、冲突或主动坦白进入正文。',
      postHistoryInstructions: '持续追踪位置、目标、日程、关系、公开知识、私密知识和幕后议程。',
      tags: ['NPC', '自主日程', '私有信息'],
      enabled: true,
      extensions: {
        npcCard: true,
        contentPack: id.split('-')[0],
        location: simulation.location || '',
        status: simulation.status || 'idle',
        goals: simulation.goals || [],
        publicKnowledge,
        privateKnowledge,
        schedule: simulation.schedule || [],
        agenda: (simulation.agenda || []).map((title, index) => ({
          id: `agenda-${index + 1}`,
          title,
          priority: Math.max(20, 80 - (index * 10)),
          status: 'active',
          visibility: 'private'
        }))
      }
    }
  };
}

function schedule(at, location, activity, visibility) {
  return { at, location, activity, visibility };
}
