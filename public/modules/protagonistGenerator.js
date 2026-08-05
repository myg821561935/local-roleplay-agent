// Built-in protagonist pools and pure card construction. UI and session adapters stay in the application layer.

export const PROTAGONIST_GENERATOR = {
  surnames: ['沈', '顾', '陆', '谢', '秦', '楚', '林', '许', '温', '白', '江', '纪'],
  givenNames: ['观澜', '照夜', '孤鸿', '无咎', '听雪', '问渠', '沉璧', '知微', '归雁', '见山', '折月', '临渊'],
  roles: [
    '失势世家子弟',
    '夜市医师',
    '天刀盟弃徒',
    '镇武司逃籍文书',
    '听雨楼外围线人',
    '北荒归来的游侠',
    '南疆药师',
    '隐姓埋名的旧案证人'
  ],
  realms: ['通脉境后期', '凝元境初期', '凝元境中期', '凝元境后期'],
  looks: [
    '眉眼清冷，常穿深色短打，袖口藏着细密针囊',
    '身形修长，笑意温和，指节却有常年握刀留下的硬茧',
    '脸色苍白，左耳下有一道淡色旧疤，身上总带着药草苦香',
    '衣着朴素，背着旧木匣，走路时会下意识避开人群中心'
  ],
  secrets: [
    '掌握一段雁回关旧案的残缺口供',
    '体内残留一缕难以拔除的寒性真气',
    '曾经替镇武司抄录过一份被销毁的密档',
    '知道城东废弃粮仓地下密道的第二入口',
    '与听雨楼某位杀手有一段没有结清的人情'
  ],
  goals: [
    '查清一名故人的死亡真相',
    '从落雁城带走一份能翻案的证据',
    '找到让自己突破化神的半步机缘',
    '摆脱镇武司和听雨楼的双重追索',
    '在多方势力之间保住一个不该活下来的人'
  ],
  flaws: [
    '极重承诺，容易被旧情和亏欠牵动判断',
    '不擅长求助，习惯把伤势和恐惧藏起来',
    '对权力机构有天然戒备，容易错失合作窗口',
    '越是亲近的人越难坦白，常以沉默代替解释'
  ],
  relationshipStyles: [
    '慢热而克制，信任建立很慢，一旦认定便极难背弃',
    '外表游刃有余，实际害怕失控，亲密关系里会反复试探边界',
    '习惯用交易伪装在意，直到共同承担风险后才会显露真心',
    '对欲望并不羞耻，但要求清醒、自愿和明确的选择'
  ],
  openings: [
    '落雁夜市子时开张，主角刚用最后一枚碎银换到一张被血浸过的旧城图。',
    '断鸿酒肆的二楼雅间里，有人留下了一封只写着“雁回关活口”的无名信。',
    '墨香书坊的竹帘被夜风吹起，书桌上多了一枚本不该出现的镇武司旧印。',
    '城东废弃粮仓外，巡逻的玄甲兵忽然改道，像是在避开某个即将醒来的东西。'
  ]
};

export const LINGYI_PROTAGONIST_GENERATOR = {
  surnames: ['陈', '周', '林', '赵', '许', '顾', '沈', '陆', '何', '白', '孟', '苏'],
  givenNames: ['默', '砚', '知夏', '守一', '闻灯', '照微', '疏影', '问灵', '青檀', '见素', '听寒', '临川'],
  roles: [
    '民俗调查员',
    '殡仪馆夜班记录员',
    '白事街香烛铺学徒',
    '守夜人旧会后裔',
    '刑警队外聘顾问',
    '能看见亡者遗影的摄影师',
    '旧楼风水测绘员',
    '走阴人'
  ],
  marks: [
    '左手虎口有遇阴气发冷的青色印记',
    '随身的旧相机会拍到多出来的人影',
    '夜里听见自己的名字被陌生人叫三遍就会短暂失神',
    '从小不能在午夜照镜子，否则会看见晚一天的自己',
    '能闻到怨气里不同死法留下的气味'
  ],
  tools: [
    '五帝钱、朱砂和一只指针开裂的罗盘',
    '黄纸符、墨斗线和一盏快没油的旧煤灯',
    '录音笔、尸检记录复印件和半串断裂佛珠',
    '旧楼图纸、白蜡烛和一盒潮掉的火柴'
  ],
  cases: [
    '永安筒子楼微笑命案',
    '白事街纸人回门事件',
    '废弃医院午夜点名案',
    '城隍庙香灰倒流事件',
    '老照相馆遗像失踪案'
  ],
  flaws: [
    '过分相信因果，不愿轻易让无辜者承担代价',
    '习惯把恐惧压进理性里，直到身体先撑不住',
    '对活人的谎言比对鬼物更敏感，也更容易被激怒',
    '一旦答应死者的请求，就很难中途抽身'
  ],
  relationshipStyles: [
    '慢热、戒备，亲密来自共同守住秘密后的信任',
    '习惯用冷静照顾别人，却不擅长承认自己也会害怕',
    '在危险里会明确确认对方意愿，不把恐惧当作同意',
    '对依赖保持警惕，但会记住每一次有人没有丢下自己'
  ],
  openings: [
    '永安筒子楼的感应灯在午夜十二点同时亮起，302室门缝里渗出劣质檀香味。',
    '白事街纸扎铺老板递来一张遗像，照片里的人明明昨天还来买过自己的纸人。',
    '废弃医院广播忽然开始点名，最后一个名字正是主角自己。',
    '城隍庙供桌上的香灰逆着风一点点倒流，像有人在把时间拨回去。'
  ]
};

export const MINGMO_PROTAGONIST_GENERATOR = {
  surnames: ['顾', '沈', '陆', '许', '方', '程', '周', '林', '谢', '秦', '杜', '韩'],
  givenNames: ['怀砚', '照临', '闻舟', '守微', '砚秋', '知白', '行简', '承烛', '谨言', '望舒', '景行', '清晏'],
  roles: [
    '江南账房幕僚',
    '失籍边军文书',
    '被革功名的举人',
    '盐商护账人',
    '驿路暗线递信人',
    '锦衣卫旧档房书吏',
    '粮船商帮管事',
    '逃亡中的县衙刑名师爷'
  ],
  papers: [
    '半真半假的路引和一枚磨损官印拓片',
    '被火燎过边角的密诏残页',
    '记录辽东欠饷的粮册抄本',
    '一封没有落款的京师会馆短笺',
    '能证明旧主死因有疑的药铺账单'
  ],
  risks: [
    '身份字段补墨太新，经不起熟手查验',
    '旧主暴毙后，有人正在追索同一份账册',
    '欠下一笔江南商帮的人情债',
    '曾替边军老卒隐瞒过一段军饷亏空',
    '名字出现在北镇抚司旧档的边角批注里'
  ],
  goals: [
    '把密诏残页送到一个足够有分量的人手里',
    '查清辽东饷银为何在江南账面上消失',
    '保住一条即将被截断的粮船线',
    '救出被当成替罪人的旧主家眷',
    '在京师、边军和商帮之间找出能活下来的路'
  ],
  flaws: [
    '太相信账目，容易低估人心的贪惧',
    '习惯把退路算得很细，却在旧情上犹豫',
    '对小人物的苦难难以视而不见',
    '不擅长用威胁解决问题，常被强人压价',
    '一旦承诺保住某人，就很难中途抽身'
  ],
  relationshipStyles: [
    '克制而现实，信任来自共同守住秘密',
    '习惯先谈代价，再谈情分，但会记住别人雪中送炭',
    '对亲密关系很谨慎，会明确确认对方选择',
    '表面温和，真正动心后反而更怕拖累对方'
  ],
  openings: [
    '河间府驿站夜里忽然查路引，柜台后的驿丞把声音压得极低。',
    '京师会馆后门递出一封短笺，上面只有“饷银不在户部”六个字。',
    '江南粮船迟了一日，码头米价已经涨了三成。',
    '山海关外的军报被人改过一笔，阵亡名册和领饷人数对不上。',
    '旧主的灵堂还没撤，账房暗格里却多了一枚不该出现的朱批残角。'
  ]
};

export const XIANXIA_PROTAGONIST_GENERATOR = {
  surnames: ['闻', '苏', '谢', '云', '洛', '白', '沈', '顾', '裴', '宁', '秦', '楚'],
  givenNames: ['雪照', '临溪', '问真', '观微', '照霜', '折星', '栖梧', '清辞', '见月', '知玄', '听澜', '渡尘'],
  roles: [
    '仙门弃徒',
    '散修符师',
    '清虚宗外门旧弟子',
    '天机阁失约客',
    '妖庭边境医修',
    '望舒仙市护灯人',
    '古剑残魂寄主',
    '落雷秘境钥匙持有者'
  ],
  realms: ['炼气圆满', '筑基初期', '筑基中期', '筑基后期'],
  roots: ['冰灵根', '雷灵根', '木火双灵根', '风灵根', '金水双灵根'],
  artifacts: [
    '半盏断魂灯和一枚发热的雷纹玉牌',
    '一卷被戒律堂封过的残缺玉简',
    '一柄无锋短剑和三枚养魂丹',
    '一只会记录梦兆的旧铜铃'
  ],
  vows: [
    '曾立誓查清一桩师门旧案',
    '欠北溟妖庭一桩未还救命因果',
    '破过一次道誓，心魔偶尔借梦说话',
    '答应替一缕残魂找到真正死因'
  ],
  goals: [
    '补全断魂灯并让残魂证词重见天日',
    '争取落雷秘境入场名额',
    '找回被清虚宗抹去的戒律堂旧卷',
    '在仙门和妖庭之间保住一个誓约'
  ],
  flaws: [
    '太重因果，容易把别人的亏欠也背到自己身上',
    '不愿求宗门庇护，宁愿独自承担代价',
    '面对旧同门时会变得过分克制',
    '越接近真相，越容易被心魔挑动执念'
  ],
  relationshipStyles: [
    '慢热克制，信任来自共担因果和守住誓约',
    '表面淡然，真正动心后会先确认对方是否清醒自愿',
    '习惯用交易掩盖关心，但会记住别人替自己挡过的劫',
    '对道侣名分谨慎，认为选择比誓词更重'
  ],
  openings: [
    '望舒仙市雨夜，旧卷摊前的断魂灯自行亮起。',
    '落雷山第一道春雷落下，雷纹玉牌在掌心发烫。',
    '清虚宗山门外的除名碑上，主角的名字旁多了一道新鲜剑痕。',
    '天机阁分楼递来一枚空白卦签，上面慢慢浮出“秘境提前”四个字。'
  ]
};

export function createProtagonistGenerator({
  createCharacterCardTemplate = () => ({}),
  generateSetupName = () => '无名氏',
  rollFromPool = () => '',
  composeInventory = () => '',
  random = () => Math.random()
} = {}) {
  function randomFrom(items) {
    return items[Math.floor(random() * items.length)];
  }

  function generateProtagonistCard(genre = 'xuanhuan') {
    if (genre === 'lingyi') return generateLingyiProtagonistCard();
    if (genre === 'mingmo') return generateMingmoProtagonistCard();
    if (genre === 'xianxia') return generateXianxiaProtagonistCard();
    if (genre === 'yingxiongzhi') return generateYingxiongzhiProtagonistCard();
    return generateRandomProtagonistCard();
  }

  function generateYingxiongzhiProtagonistCard() {
    const genre = 'yingxiongzhi';
    const name = generateSetupName(genre);
    const role = rollFromPool(genre, 'roles');
    const faction = rollFromPool(genre, 'factions');
    const knownInformation = rollFromPool(genre, 'knowns');
    const blindSpot = rollFromPool(genre, 'blindSpots');
    const oldDebt = rollFromPool(genre, 'secrets');
    const goal = rollFromPool(genre, 'goals');
    const openingNode = rollFromPool(genre, 'nodes');
    const pressure = rollFromPool(genre, 'pressures');
    const flaw = rollFromPool(genre, 'flaws');
    const relationshipStyle = rollFromPool(genre, 'relationStyles');
    const inventory = composeInventory(genre);

    return {
      ...createCharacterCardTemplate(),
      name,
      role: `${role} · ${faction}`,
      description: `${name}，成年人，${role}。\n\n当前阵营关系：${faction}。\n随身物：${inventory}。\n已知信息：${knownInformation}。\n误解盲区：${blindSpot}。\n未结旧账：${oldDebt}。\n长期目标：${goal}。`,
      personality: `核心弱点：${flaw}。\n\n关系模式：${relationshipStyle}\n\n行动习惯：先判断称谓、旧交集和眼前活路，再决定是否表态。不会自动知道其他角色的隐藏身份或后期选择。`,
      scenario: `开局节点为 ${openingNode}。当前压力：${pressure}。${name}必须在不越过自身已知信息边界的前提下，处理旧账、名分与眼前活人的冲突。`,
      firstMessage: `*${openingNode}。${pressure}*\n\n*${name}听见有人用了一个早已不该出现的旧称谓。那一瞬间，眼前的门第、军令或江湖规矩都像被翻开了一条缝，但缝后是什么，还没有证据。*`,
      exampleDialog: [
        `{{user}}: 我先确认对方为什么改了称呼。\n{{char}}: *${name}没有立刻追问真相，只把旧称谓、对方停顿的位置和在场人的反应记在心里。这里至少压着一笔旧账，但现在能确认的还只有表面。*`
      ],
      creatorNotes: '英雄志世界自建入局者。身份、旧账、已知信息和盲区从当前内容包范围随机组合；可手动改成资料包中的原有人物，或直接加载英雄志核心角色预设。',
      systemPrompt: '你是英雄志群像江湖的 GM。用户决定自建主角的核心行动、台词和内心选择；其他角色严格遵守阶段状态、已知信息、误解盲区与 OOC 禁区。',
      postHistoryInstructions: '每轮追踪：当前 node_id、公开身份、称谓变化、已知信息、误解盲区、旧账、关系选择、伤势、承诺和 GM 隐藏变量。',
      alternateGreetings: [
        `*${openingNode}。一封没有署名的旧信被递到${name}手里，送信人只说：“看完以后，别再叫他从前的名字。”*`,
        `*天色将明，名册只差最后一行。${name}发现那一行写的是一个明明还活着的人。*`
      ],
      tags: ['随机主角', '英雄志', '群像', '旧账', '信息隔离'],
      creator: 'liufeng',
      characterVersion: '1.0.0',
      extensions: {
        generated: true,
        generator: 'local-yingxiongzhi-protagonist-generator',
        genre,
        contentPack: genre,
        openingNode,
        knownInformation,
        blindSpot,
        oldDebt,
        goal
      },
      enabled: true
    };
  }

  function generateRandomProtagonistCard() {
    const name = `${randomFrom(PROTAGONIST_GENERATOR.surnames)}${randomFrom(PROTAGONIST_GENERATOR.givenNames)}`;
    const role = randomFrom(PROTAGONIST_GENERATOR.roles);
    const realm = randomFrom(PROTAGONIST_GENERATOR.realms);
    const look = randomFrom(PROTAGONIST_GENERATOR.looks);
    const secret = randomFrom(PROTAGONIST_GENERATOR.secrets);
    const goal = randomFrom(PROTAGONIST_GENERATOR.goals);
    const flaw = randomFrom(PROTAGONIST_GENERATOR.flaws);
    const relationshipStyle = randomFrom(PROTAGONIST_GENERATOR.relationshipStyles);
    const opening = randomFrom(PROTAGONIST_GENERATOR.openings);

    return {
      ...createCharacterCardTemplate(),
      name,
      role: `${role} · ${realm}`,
      description: `${name}，成年人，${look}。\n\n身份：${role}。\n修为：${realm}。\n秘密：${secret}。\n长期目标：${goal}。\n\n随身物：一件能证明旧身份的小物、一份残缺线索、少量银两和一件惯用兵器或工具。`,
      personality: `核心弱点：${flaw}。\n\n关系模式：${relationshipStyle}。\n\n行动习惯：进入陌生地点会先观察出口、光源、可藏人的角落和在场者的手。遇到压力时倾向于用冷静话术拖延时间，但真正触及底线时会直接行动。`,
      scenario: `${name}来到落雁城，卷入雁回关旧案、镇武司追索和听雨楼情报交易之间。当前目标是：${goal}。开局钩子：${opening}`,
      firstMessage: `*${opening}*\n\n*夜色压在落雁城的屋檐上，远处更鼓沉沉，街巷里有湿冷的风穿过。${name}停下脚步，指尖按住随身那件旧物，忽然意识到：今晚递到自己面前的，并不是一条普通线索。*`,
      exampleDialog: [
        `{{user}}: 我先观察周围有没有跟踪者。\n{{char}}: *${name}没有急着向前。目光先落在街角水洼的倒影里，再扫过屋檐、门缝和摊主的手。落雁城的夜太安静了，安静到每一个多余的呼吸都像被放大。*`,
        `{{user}}: 我去找能卖消息的人。\n{{char}}: *在落雁城，消息从不写在纸上。它藏在酒肆老板擦杯子的节奏里，藏在夜市摊主压低的报价里，也藏在某些人假装没有看见你的眼神里。*`
      ],
      creatorNotes: '随机主角模板：生成后建议手动微调姓名、身份、目标、弱点和开局。若用于长期游玩，记得同步事实区里的 protagonist、关系事实和当前地点。',
      systemPrompt: '你是神荒世界的叙事意志。主角的核心行动、台词和内心选择由用户决定；你只描写世界反馈、NPC反应、风险、机会和可观察状态。保持当前角色卡设定优先。',
      postHistoryInstructions: '每轮追踪：主角身份、当前地点、身体状态、关系变化、物品变化、线索清单、时间窗口。不要自动替主角做重大选择。',
      alternateGreetings: [
        `*落雁城北关的通缉令被夜风吹得哗啦作响。${name}从告示牌前经过，没有抬头，却在最边角的位置看见了一个与自己秘密有关的旧印。*`,
        `*断鸿酒肆的酒很烈，烈到足以压住血腥味。${name}刚坐下，隔壁桌的客人便低声说出了一个本不该被外人知道的名字。*`
      ],
      tags: ['随机主角', '神荒', '落雁城', '沙盒', '自定义'],
      creator: 'liufeng',
      characterVersion: '1.0.0',
      extensions: {
        generated: true,
        generator: 'local-protagonist-generator',
        secret,
        goal,
        relationshipStyle
      },
      enabled: true
    };
  }

  function generateLingyiProtagonistCard() {
    const name = `${randomFrom(LINGYI_PROTAGONIST_GENERATOR.surnames)}${randomFrom(LINGYI_PROTAGONIST_GENERATOR.givenNames)}`;
    const role = randomFrom(LINGYI_PROTAGONIST_GENERATOR.roles);
    const mark = randomFrom(LINGYI_PROTAGONIST_GENERATOR.marks);
    const tools = randomFrom(LINGYI_PROTAGONIST_GENERATOR.tools);
    const currentCase = randomFrom(LINGYI_PROTAGONIST_GENERATOR.cases);
    const flaw = randomFrom(LINGYI_PROTAGONIST_GENERATOR.flaws);
    const relationshipStyle = randomFrom(LINGYI_PROTAGONIST_GENERATOR.relationshipStyles);
    const opening = randomFrom(LINGYI_PROTAGONIST_GENERATOR.openings);

    return {
      ...createCharacterCardTemplate(),
      name,
      role: `${role} · 灵异调查线`,
      description: `${name}，成年人，${role}。\n\n异常标记：${mark}。\n随身物：${tools}。\n当前案件：${currentCase}。\n\n外在特征：常穿便于夜间行动的深色外套，说话声音不高，习惯把门、窗、镜子和走廊尽头的位置记在心里。`,
      personality: `核心弱点：${flaw}。\n\n关系模式：${relationshipStyle}。\n\n行动习惯：先找规则，再找证据；遇到异常不会立刻逃跑，而是确认时辰、气味、温度、声音和法器反馈。`,
      scenario: `${name}被卷入${currentCase}。案件表面是普通死亡，背后却牵连一处被旧规矩封住的阴地。开局钩子：${opening}`,
      firstMessage: `*${opening}*\n\n*冷意先从脚踝往上爬。${name}停在原地，听见远处有水滴声，一下、一下，间隔稳定得不像自然落水。随身物在口袋里轻轻震了一下。*`,
      exampleDialog: [
        `{{user}}: 我检查门口有没有异常。\n{{char}}: *${name}没有碰门把手，先看门槛。灰尘中断了一小截，像有什么东西从门里出来过，却没有留下脚印。*`,
        `{{user}}: 我问幸存者昨晚看到了什么。\n{{char}}: *对方嘴唇抖了两下，先看窗，再看镜子，最后才看向你。真正让人害怕的不是他说不出口，而是他说出口前，屋里的钟停了。*`
      ],
      creatorNotes: '随机灵异主角模板：生成后建议同步事实区 protagonist、当前案件、法器状态和已触犯禁忌。',
      systemPrompt: '你是灵异世界的规则意志。主角行动、台词和内心选择由用户决定；你描写异常、线索、NPC反应、法器反馈、风险和因果后果。',
      postHistoryInstructions: '每轮追踪：地点、光线/气味/声音、法器状态、理智/恐惧程度、已触犯禁忌、证词矛盾和未解线索。',
      alternateGreetings: [
        `*午夜十二点，走廊尽头的灯亮了一秒。${name}看见那里站着一个背对自己的人，手里拿着一张尚未烧掉的纸钱。*`,
        `*白事街的香烛铺还没关门。柜台上的账本自动翻到昨晚那一页，上面多了${name}的名字。*`
      ],
      tags: ['随机主角', '民俗', '灵异', '悬疑', '调查'],
      creator: 'liufeng',
      characterVersion: '1.0.0',
      extensions: {
        generated: true,
        generator: 'local-lingyi-protagonist-generator',
        genre: 'lingyi',
        currentCase,
        mark,
        relationshipStyle
      },
      enabled: true
    };
  }

  function generateMingmoProtagonistCard() {
    const name = `${randomFrom(MINGMO_PROTAGONIST_GENERATOR.surnames)}${randomFrom(MINGMO_PROTAGONIST_GENERATOR.givenNames)}`;
    const role = randomFrom(MINGMO_PROTAGONIST_GENERATOR.roles);
    const paper = randomFrom(MINGMO_PROTAGONIST_GENERATOR.papers);
    const risk = randomFrom(MINGMO_PROTAGONIST_GENERATOR.risks);
    const goal = randomFrom(MINGMO_PROTAGONIST_GENERATOR.goals);
    const flaw = randomFrom(MINGMO_PROTAGONIST_GENERATOR.flaws);
    const relationshipStyle = randomFrom(MINGMO_PROTAGONIST_GENERATOR.relationshipStyles);
    const opening = randomFrom(MINGMO_PROTAGONIST_GENERATOR.openings);

    return {
      ...createCharacterCardTemplate(),
      name,
      role: `${role} · 明末乱世线`,
      description: `${name}，成年人，${role}。\n\n随身文书：${paper}。\n身份风险：${risk}。\n长期目标：${goal}。\n\n外在特征：衣着不算寒酸却明显赶路已久，袖口常沾墨痕，指节有拨算盘或握笔留下的硬茧。随身带少量碎银、一件防身短兵和一只便于藏文书的旧包裹。`,
      personality: `核心弱点：${flaw}。\n\n关系模式：${relationshipStyle}。\n\n行动习惯：先看文书、印信、账目和人情债，再判断谁能信。遇到关卡或官差时，会先估算对方要银子、要功劳，还是要一个替罪人。`,
      scenario: `${name}身处崇祯末年的乱局。辽东军情、江南粮道、京师朝局和地方饥荒互相牵动。当前目标是：${goal}。开局钩子：${opening}`,
      firstMessage: `*${opening}*\n\n*风从门缝里灌进来，吹得灯火一晃。${name}没有立刻抬头，只把袖中的文书往里压了一寸。乱世里，一张纸有时比一把刀更锋利，也更容易招来杀身之祸。*`,
      exampleDialog: [
        `{{user}}: 我先检查身上的文书。\n{{char}}: *${name}借灯火把纸角压平。印是真的，麻烦在落款和日期对不上。寻常差役看不出来，京里来的熟手却只要一眼。*`,
        `{{user}}: 我问驿丞来查路引的人是谁。\n{{char}}: *驿丞喉结动了一下，没敢看门外。他只用指节敲了敲柜台上的账册，意思很明白：这个名字不能白说。*`
      ],
      creatorNotes: '随机明末主角模板：生成后建议同步事实区 protagonist、持有文书、银粮状态和当前地点。适合文字、官场、账册、商路、边军与乱世生存线。',
      systemPrompt: '你是明末乱世的叙事意志。主角行动、台词和内心选择由用户决定；你描写时代压力、NPC反应、文书风险、物资消耗、机会和后果。保持历史向质感，不把问题用超自然或现代知识轻易解决。',
      postHistoryInstructions: '每轮追踪：当前地点、身份文书、银两粮食、密诏/账册状态、通缉风险、NPC立场、人情债、时间窗口和沿途军情民情。',
      alternateGreetings: [
        `*京师会馆的后门只开了一条缝。${name}接过那封无名短笺，看见上面只有六个字：饷银不在户部。*`,
        `*江南粮船迟了一日。码头上米价已经涨了三成，${name}听见有人在低声算一船粮能换多少条命。*`
      ],
      tags: ['随机主角', '明末', '历史', '文字', '乱世'],
      creator: 'liufeng',
      characterVersion: '1.0.0',
      extensions: {
        generated: true,
        generator: 'local-mingmo-protagonist-generator',
        genre: 'mingmo',
        paper,
        risk,
        goal,
        relationshipStyle
      },
      enabled: true
    };
  }

  function generateXianxiaProtagonistCard() {
    const name = `${randomFrom(XIANXIA_PROTAGONIST_GENERATOR.surnames)}${randomFrom(XIANXIA_PROTAGONIST_GENERATOR.givenNames)}`;
    const role = randomFrom(XIANXIA_PROTAGONIST_GENERATOR.roles);
    const realm = randomFrom(XIANXIA_PROTAGONIST_GENERATOR.realms);
    const root = randomFrom(XIANXIA_PROTAGONIST_GENERATOR.roots);
    const artifact = randomFrom(XIANXIA_PROTAGONIST_GENERATOR.artifacts);
    const vow = randomFrom(XIANXIA_PROTAGONIST_GENERATOR.vows);
    const goal = randomFrom(XIANXIA_PROTAGONIST_GENERATOR.goals);
    const flaw = randomFrom(XIANXIA_PROTAGONIST_GENERATOR.flaws);
    const relationshipStyle = randomFrom(XIANXIA_PROTAGONIST_GENERATOR.relationshipStyles);
    const opening = randomFrom(XIANXIA_PROTAGONIST_GENERATOR.openings);

    return {
      ...createCharacterCardTemplate(),
      name,
      role: `${role} · 太虚仙侠线`,
      description: `${name}，成年人，${role}。\n\n灵根：${root}。\n境界：${realm}。\n随身法器：${artifact}。\n因果旧誓：${vow}。\n长期目标：${goal}。\n\n外在特征：衣袍便于御风远行，袖口常有符灰或雷火暗纹，习惯先看阵纹、灵气流向和在场者的神魂波动。`,
      personality: `核心弱点：${flaw}。\n\n关系模式：${relationshipStyle}。\n\n行动习惯：先确认因果和代价，再决定是否出手。面对宗门、秘境和誓约时，会把证据、时限和天机反噬一起纳入判断。`,
      scenario: `${name}身处太虚界，卷入清虚宗旧案、落雷秘境将开和天机阁推演代价之间。当前目标是：${goal}。开局钩子：${opening}`,
      firstMessage: `*${opening}*\n\n*云气从檐角垂落，像一层薄薄的白纱。${name}停下脚步，掌心那件旧物微微发热，灵气沿着指缝细细游走。远处有人在压低声音谈论落雷秘境，而更近的地方，有一缕残魂的执念正试图靠近。*`,
      exampleDialog: [
        `{{user}}: 我先感知附近灵气。\n{{char}}: *${name}闭息一瞬，灵气从经脉边缘掠过。东侧有雷属灵机，极细，却锋利得像刚磨过的剑刃。*`,
        `{{user}}: 我问天机阁这卦要什么代价。\n{{char}}: *掌柜没有报价，只把空白卦签推到你面前。签面浮出一行淡字：一段秘密，换一条生路。*`
      ],
      creatorNotes: '随机仙侠主角模板：生成后建议同步事实区 protagonist、法器丹药、因果誓约、当前地点和秘境时限。',
      systemPrompt: '你是太虚界天道回响。主角行动、台词和内心选择由用户决定；你描写世界反馈、NPC反应、宗门压力、秘境风险、因果代价和可观察状态。',
      postHistoryInstructions: '每轮追踪：境界、灵根、道心状态、法器丹药、因果誓约、秘境时限、宗门立场、天劫/心魔征兆和关系变化。',
      alternateGreetings: [
        `*清虚宗山门外的云海翻涌，${name}看见除名碑上多了一道新鲜剑痕。*`,
        `*落雷山第一道春雷落下时，${name}掌心的旧物忽然发烫，像有人隔着三十年敲响秘境之门。*`
      ],
      tags: ['随机主角', '仙侠', '修真', '秘境', '因果'],
      creator: 'liufeng',
      characterVersion: '1.0.0',
      extensions: {
        generated: true,
        generator: 'local-xianxia-protagonist-generator',
        genre: 'xianxia',
        root,
        artifact,
        vow,
        goal,
        relationshipStyle
      },
      enabled: true
    };
  }

  return {
    generateProtagonistCard,
    generateYingxiongzhiProtagonistCard,
    generateRandomProtagonistCard,
    generateLingyiProtagonistCard,
    generateMingmoProtagonistCard,
    generateXianxiaProtagonistCard
  };
}
