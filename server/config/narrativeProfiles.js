const profiles = {
  xuanhuan: {
    label: '神荒玄幻',
    activeArc: '查清雁回关旧案并在落雁城势力夹缝中恢复立足之地',
    corePillars: ['武道成长与境界规则', '雁回旧案与人物关系', '宗门、朝廷和江湖势力博弈', '资源、伤势与因果代价'],
    supportingElements: ['野外探索', '遗迹解密', '生存压力', '悬疑调查', '成人关系与情感线'],
    forbiddenDominance: ['纯荒野求生取代武道与旧案', '连续机关谜题不回流功法、势力或证据', '灵异、末日或科幻规则改写世界底层'],
    supportingArcs: ['调查城东废弃粮仓的异常灯火', '追踪镇武司旧档与苏沐白去向', '处理左肩旧伤并寻找功法突破契机'],
    routeReturnRule: '探索或遗迹场景必须在两轮内回流到境界成长、雁回旧案、势力选择、资源得失或人物旧债中的至少一项；不能把发现新地点本身当作主线。',
    inspirationRefs: ['斗破苍穹', '遮天', '完美世界', '夜无疆', '元始法则', '苟在武道世界成圣', '诡秘之主', '剑来', '帝霸'],
    referenceFocus: [
      { works: ['斗破苍穹', '帝霸'], method: '提炼低谷起步、能力阶梯和阶段性反馈，但升级必须消耗资源并改变人物处境。' },
      { works: ['遮天', '完美世界', '夜无疆'], method: '提炼宏大历史尺度、遗迹与当世秩序互相解释的结构，不让远古设定脱离当前矛盾。' },
      { works: ['诡秘之主', '元始法则'], method: '提炼隐秘规则、组织层级和有限信息，让真相通过证据与代价逐层打开。' },
      { works: ['剑来', '苟在武道世界成圣'], method: '提炼地方秩序、谨慎生存和长期因果，让小人物选择持续影响后续关系与名声。' }
    ]
  },
  lingyi: {
    label: '民俗灵异',
    activeArc: '查清永安筒子楼微笑命案并验证倒悬八卦阵的真实用途',
    corePillars: ['异常规则与民俗因果', '证据链和多重假设', '污染、代价与生路', '活人与亡者的未竟关系'],
    supportingElements: ['刑侦调查', '封闭空间探索', '逃生', '地方传说', '人物关系'],
    forbiddenDominance: ['纯战斗升级取代调查和规则', '玄幻修炼体系改写异常逻辑', '无证据的万能法器直接解决案件'],
    supportingArcs: ['核对302室、楼顶水箱与地下泵房的时间记录', '追查守夜人旧会和二十年前坠楼事故', '控制陈默左手阴印的污染进度'],
    routeReturnRule: '每次探索必须产出可追溯证据、更新至少一个假设，并说明污染或时间成本；新增怪谈若不能解释当前案件，就只能作为传闻而不能扩张成新主线。',
    inspirationRefs: ['鬼吹灯', '盗墓笔记', '捞尸人', '异度旅社', '诡秘之主', '我有一座恐怖屋', '神秘复苏', '我当阴阳先生的那几年', '地狱公寓', '茅山后裔', '最后一个道士', '镇妖博物馆', '超级惊悚直播', '诡舍'],
    referenceFocus: [
      { works: ['鬼吹灯', '盗墓笔记', '捞尸人'], method: '提炼空间、器物、地方历史和人物旧事共同组成证据链的调查结构。' },
      { works: ['神秘复苏', '地狱公寓', '诡舍'], method: '提炼异常规则、错误试探和使用力量的代价，让生路来自验证而非万能术法。' },
      { works: ['我有一座恐怖屋', '超级惊悚直播', '异度旅社'], method: '提炼封闭场景递进、观察者压力和仪式节点，但场景始终服务当前案件。' },
      { works: ['我当阴阳先生的那几年', '茅山后裔', '最后一个道士', '镇妖博物馆'], method: '提炼民俗法脉、地方因果和传承边界，避免把民俗符号写成随取随用的装饰。' },
      { works: ['诡秘之主'], method: '提炼隐秘组织、信息分层与污染认知，不移植其力量体系。' }
    ]
  },
  mingmo: {
    label: '明末历史',
    activeArc: '查清密诏残页与江南粮道暗账，并在银粮断裂前找到可执行的自保路径',
    corePillars: ['身份文书与证据链', '银粮、交通和执行成本', '官场、商帮与边军博弈', '乱世中的人物选择与民生后果'],
    supportingElements: ['旅途探索', '悬案调查', '战斗逃亡', '商路经营', '人物关系'],
    forbiddenDominance: ['现代知识无成本改造天下', '玄幻或灵异力量解决制度问题', '纯冒险寻宝取代银粮与政治主线'],
    supportingArcs: ['保住粮册抄本与半真路引', '核对辽东欠饷的经手链条', '判断商帮、士绅与边军中谁可暂时结盟'],
    routeReturnRule: '旅途、刺杀、破案或经营场景都必须回到账册、印信、银粮、交通、身份或执行后果；任何方案都要回答谁出钱、谁签字、谁经手、多久生效和谁承担损失。',
    inspirationRefs: ['庆余年', '赘婿', '大明王朝1566', '回到明朝当王爷', '宰执天下', '极品家丁', '穷鬼的上下两千年', '覆汉', '秦吏', '唐砖', '绍宋', '高门庶子', '状元郎', '朕'],
    referenceFocus: [
      { works: ['大明王朝1566', '宰执天下', '状元郎'], method: '提炼财政约束、官僚执行链和文书责任，让制度通过具体经手人显形。' },
      { works: ['秦吏', '覆汉', '绍宋', '朕'], method: '提炼基层治理、军事后勤、皇权信息失真和时代约束，拒绝一句话改变天下。' },
      { works: ['赘婿', '庆余年', '高门庶子'], method: '提炼商贸网络、家族门第、权力信息差与人物关系中的利益交换。' },
      { works: ['回到明朝当王爷', '极品家丁', '唐砖'], method: '提炼现代读者可进入的日常制度和轻重节奏，但现代知识必须经过材料、组织与试错。' },
      { works: ['穷鬼的上下两千年'], method: '提炼大时代中的小人物视角，让宏观崩解落实为粮价、差役、流亡和亲友命运。' }
    ]
  },
  xianxia: {
    label: '太虚仙侠',
    activeArc: '补全断魂灯并查清清虚宗听雪峰旧案',
    corePillars: ['修行道途与境界代价', '宗门、家族和师承的代际传承', '灵脉、丹器、账目与资源权属', '因果誓约、道心与劫数'],
    supportingElements: ['秘境探索', '遗迹解密', '野外生存', '师门旧案调查', '道侣与人物关系'],
    forbiddenDominance: ['纯荒野探险取代修行和宗门/家族主线', '连续机关解密不回流因果、资源或传承', '游戏副本式刷宝抹去所有权、族务账目与未来追索'],
    supportingArcs: ['争取落雷秘境名额', '追查清虚宗资源缩配与地脉导流', '结算北溟妖庭救命因果与断魂灯权属'],
    routeReturnRule: '秘境、远游和夺宝必须回流到个人道途、宗门或家族资源、传承权属、师门旧案或因果追索；所得不是无主掉落，突破也必须结算身体、神魂和组织后果。',
    inspirationRefs: ['凡人修仙传', '仙逆', '诛仙', '遮天', '玄鉴仙族', '赤心巡天', '山河稷', '没钱修什么仙', '光阴之外'],
    referenceFocus: [
      { works: ['凡人修仙传', '没钱修什么仙'], method: '提炼资源稀缺、谨慎决策和可追踪成长，让每次进阶有明确来源与成本。' },
      { works: ['玄鉴仙族'], method: '提炼家族作为长期主体、代际传承、族务账目、资源权属和有限信息的严谨结构。' },
      { works: ['赤心巡天', '山河稷'], method: '提炼制度、道心辩难与人物选择，使修行道路同时接受公共秩序的检验。' },
      { works: ['诛仙', '仙逆', '光阴之外'], method: '提炼师承情债、执念、谨慎求生和力量反噬，不用境界数字替代人物变化。' },
      { works: ['遮天'], method: '提炼断代历史与当世势力互相解释的尺度，但所有遗迹必须影响当前资源与因果。' }
    ]
  },
  yingxiongzhi: {
    label: '英雄志群像',
    activeArc: '推进E02乱世文章节点，并在不越过角色信息边界的前提下结算人物旧账',
    corePillars: ['人物旧账与关系选择', '江湖和庙堂的双重秩序', '角色信息边界与误解', '现实资源、名分与行动后果'],
    supportingElements: ['旅途冒险', '武林悬案', '战场行动', '私人情感', '短期结盟'],
    forbiddenDominance: ['纯升级爽文取代群像选择', '无证据的全知揭秘', '连续寻宝解谜取代旧账与秩序冲突'],
    supportingArcs: ['守住当前角色的已知信息与误解边界', '推进一笔个人旧账或关系选择', '让当前节点连接江湖与庙堂的现实后果'],
    routeReturnRule: '每个支线场景必须回流到当前剧情节点、人物旧账、信息边界或江湖与庙堂秩序中的至少一项；未在节点中的人物不能为了热闹强行登场。',
    inspirationRefs: ['英雄志', '鹿鼎记', '笑傲江湖', '将夜', '雪中悍刀行', '庆余年'],
    referenceFocus: [
      { works: ['英雄志'], method: '按用户资料包使用人物、关系和阶段状态，重点维持群像旧账、信息隔离与江湖庙堂双线。' },
      { works: ['鹿鼎记', '笑傲江湖'], method: '提炼身份错位、组织逻辑、名声压力与人物机变，不引入其人物或具体事件。' },
      { works: ['将夜', '雪中悍刀行'], method: '提炼个人选择与宏大秩序的碰撞，以及长篇关系伏笔的回收。' },
      { works: ['庆余年'], method: '提炼权力信息差、名分与执行后果，不移植其人物、机构或情节。' }
    ]
  }
};

export const GENRE_INSPIRATION_REFS = Object.fromEntries(
  Object.entries(profiles).map(([id, profile]) => [id, [...profile.inspirationRefs]])
);

export function getGenreNarrativeProfile(packId) {
  const profile = profiles[String(packId || '')];
  return profile ? structuredClone(profile) : null;
}

export function createNarrativeState(packId) {
  const id = String(packId || '');
  const profile = profiles[id];
  if (!profile) return null;
  return {
    activeArc: profile.activeArc,
    corePillars: [...profile.corePillars],
    supportingElements: [...profile.supportingElements],
    forbiddenDominance: [...profile.forbiddenDominance],
    supportingArcs: [...profile.supportingArcs],
    routeReturnRule: profile.routeReturnRule,
    lockedGenre: id,
    referenceFocus: profile.referenceFocus.map(formatReferenceFocus),
    lastConfirmedBy: 'content-pack'
  };
}

export function enrichNarrativeState(packId, currentState) {
  const defaults = createNarrativeState(packId);
  if (!defaults) return currentState && typeof currentState === 'object' ? structuredClone(currentState) : null;
  const current = currentState && typeof currentState === 'object' ? currentState : {};
  return {
    ...defaults,
    ...structuredClone(current),
    activeArc: String(current.activeArc || '').trim() || defaults.activeArc,
    corePillars: preferExistingList(current.corePillars, defaults.corePillars),
    supportingElements: preferExistingList(current.supportingElements, defaults.supportingElements),
    forbiddenDominance: preferExistingList(current.forbiddenDominance, defaults.forbiddenDominance),
    supportingArcs: preferExistingList(current.supportingArcs, defaults.supportingArcs),
    routeReturnRule: String(current.routeReturnRule || '').trim() || defaults.routeReturnRule,
    lockedGenre: String(current.lockedGenre || '').trim() || defaults.lockedGenre,
    referenceFocus: preferExistingList(current.referenceFocus, defaults.referenceFocus),
    lastConfirmedBy: String(current.lastConfirmedBy || '').trim() || defaults.lastConfirmedBy
  };
}

export function buildGenreReferenceMethodContent(packId, methodText, options = {}) {
  const profile = profiles[String(packId || '')];
  const refs = (profile?.inspirationRefs || []).map((name) => `《${name}》`).join('、');
  const breakdown = (profile?.referenceFocus || []).map((item) => `- ${formatReferenceFocus(item)}`);
  const boundary = options.allowPrimarySourceCanon
    ? '《英雄志》资料包中的人物、关系与阶段状态可按用户提供资料使用；其余作品只借鉴题材背景、叙事节奏、信息组织和冲突手法，不移植人物、势力、剧情或专有名词。'
    : '只借鉴题材背景、叙事节奏、信息组织和冲突手法；不复刻原作人物、势力、剧情或专有名词。';
  return [
    `方法论参考：${refs}。`,
    methodText,
    breakdown.length ? `参考拆解：\n${breakdown.join('\n')}` : '',
    boundary
  ].filter(Boolean).join('\n');
}

function formatReferenceFocus(item) {
  const works = (item.works || []).map((name) => `《${name}》`).join('、');
  return `${works}：${item.method}`;
}

function preferExistingList(value, fallback) {
  return Array.isArray(value) && value.length ? structuredClone(value) : structuredClone(fallback);
}
