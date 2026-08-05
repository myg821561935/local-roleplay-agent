export const OPENING_GENRE_OPTIONS = [
  {
    id: 'xuanhuan',
    label: '玄幻',
    title: '神荒玄幻',
    hint: '武道、秘境、榜单、旧案'
  },
  {
    id: 'lingyi',
    label: '灵异',
    title: '民俗灵异',
    hint: '禁忌、案件、旧楼、因果'
  },
  {
    id: 'mingmo',
    label: '历史',
    title: '明末风云',
    hint: '银粮、路引、密诏、乱世'
  },
  {
    id: 'xianxia',
    label: '仙侠',
    title: '太虚仙侠',
    hint: '仙门、因果、秘境、道心'
  },
  {
    id: 'yingxiongzhi',
    label: '英雄志',
    title: '英雄志群像',
    hint: '五朝、旧账、群像、信息隔离'
  }
];

export const PROLOGUE_RANDOM_POOLS = {
  shared: {
    genders: ['男', '女', '自定义', '不主动声明'],
    relationStyles: [
      '慢热试探，信任来自共同承担风险后的清醒选择。',
      '先谈代价再谈情分，但会记住雪中送炭的人。',
      '习惯把在意藏进行动里，不用承诺换取服从。',
      '关系推进必须明确、自愿、可拒绝，越危险越需要确认边界。'
    ]
  },
  xuanhuan: {
    surnames: ['沈', '顾', '叶', '秦', '陆', '林', '苏', '谢', '闻', '楚'],
    givenNames: ['观澜', '沉舟', '照夜', '长歌', '惊羽', '怀刃', '听寒', '无衣', '折霜', '见微'],
    aliases: ['旧刀客', '雁回遗孤', '夜市药师', '镇武弃徒', '听雨楼线人', '北荒归客'],
    ages: ['17', '19', '22', '24', '27', '31', '35', '42', '49', '56'],
    looks: ['灰衣旧刀，眉骨锋利', '白衣胜雪，指节有药草苦香', '玄色短打，袖口缝着暗纹', '披旧斗笠，靴底常沾夜市泥水', '身形清瘦，背负不合身的重刀'],
    marks: ['左肩有遇寒作痛的旧伤', '腕间缠着雁回关军中红绳', '眼底藏着长期失眠的血丝', '掌心有镇武司旧印烫痕', '腰牌裂成两半仍贴身收藏'],
    temperaments: ['重诺寡言', '冷静克制', '嫉恶如仇', '谨慎苟道', '外柔内硬', '看似散漫实则记仇'],
    flaws: ['涉及旧案时判断会被愧疚牵动', '不愿欠人情，反而容易被交易套牢', '习惯独自承担风险，难以求援', '对弱者心软，会因此错失先手'],
    realms: ['通脉境中期', '通脉境后期', '凝元境初期', '凝元境大成', '化神境初期', '半步天象'],
    martialArts: ['沉字快刀', '七杀剑诀残篇', '断雨十三式', '影卫潜踪术', '大悲撕风手', '北荒折骨刀', '听雨楼无声步'],
    styles: ['去繁留简，重一击破局', '偏暗杀与脱身，不适合正面久战', '爆发极强，真气消耗也极重', '需借雨夜、窄巷或高处发挥', '会牵动旧伤，连续使用有代价'],
    factions: ['镇武司旧影卫', '听雨楼外围线人', '天刀盟弃徒', '落雁夜市药师', '北荒归来的游侠', '墨香书坊暗桩'],
    items: ['沉字刀', '断裂传音符', '秦无衣旧铜扣', '夜市城图', '跌打伤药', '半枚影卫腰牌', '作废路引', '寒玉药瓶'],
    secrets: ['掌握一段雁回关旧案的残缺口供', '知道城东废弃粮仓地下密道的第二入口', '曾替镇武司抄录过一份被销毁的密档', '与听雨楼杀手有一段没有结清的人情', '旧刀鞘内藏着防线图的一角'],
    goals: ['查清雁回关泄密真相', '从落雁城带走能翻案的证据', '找到第七名雁回关活口', '在镇武司封城前救出不该活下来的人', '让天机榜批语指向真正的幕后人'],
    pressures: ['玄甲兵今晚子时封城，夜市入口只开一刻', '听雨楼线人要求用一个人情换线索', '北荒商队带着假药材入城，目标不是钱', '旧伤在雨夜复燃，拔刀速度会慢半拍']
  },
  lingyi: {
    surnames: ['陈', '唐', '沈', '白', '陆', '林', '赵', '许', '周', '乔'],
    givenNames: ['默', '月', '问灵', '照微', '青檀', '归夜', '怀灯', '知寒', '守一', '晚声'],
    aliases: ['守夜人后裔', '白事街学徒', '刑警顾问', '旧楼幸存者', '走阴记录员'],
    ages: ['22', '24', '27', '31', '36', '42', '47', '53'],
    roles: ['民俗调查员', '刑警队外聘顾问', '殡仪馆夜班记录员', '白事街香烛铺学徒', '守夜人旧会后裔', '旧楼拆迁档案员'],
    looks: ['黑色旧夹克，身上有烟味和朱砂气味', '短发利落，警服外套常沾雨水', '指尖有檀香灰，衣领藏着裂开的铜钱', '脸色苍白，随身带着红线缠过的钥匙', '眼神疲惫，录音笔从不离身'],
    marks: ['左手虎口有遇阴气发冷的青印', '旧相机会拍到多出来的人影', '午夜听见自己名字被叫三遍会短暂失神', '不能照镜子，否则会看见晚一天的自己', '门牌号会在视野边缘短暂变成302'],
    temperaments: ['理性执拗', '冷静照护', '嘴硬心软', '谨慎多疑', '对死者极有耐心', '越害怕越要查清楚'],
    flaws: ['会过分相信因果，不愿让无辜者承担代价', '听见水滴声会判断迟缓', '面对儿童证词时容易失去距离感', '不擅长承认自己害怕'],
    tools: ['五帝钱', '旧罗盘', '黄纸符', '朱砂', '录音笔', '尸检记录复印件', '旧楼图纸', '白蜡烛', '潮掉的火柴', '半串断裂佛珠'],
    cases: ['永安筒子楼微笑命案', '白事街纸人回门事件', '废弃医院午夜点名案', '城隍庙香灰倒流事件', '旧电梯井失踪案'],
    secrets: ['302室镜子背后的头发正逐渐变长', '第一名死者的死亡时间被人为提前了二十分钟', '楼管登记簿里少了一个不存在的住户', '八个节点里有一个是活人', '监控缺帧前出现过同一段童谣'],
    goals: ['确认第一名死者真正死亡时间', '查清302室镜子背后的头发是谁的', '找出倒悬八卦阵八个节点', '在午夜前阻止下一次点名', '证明活人是否在替鬼说话'],
    pressures: ['楼内广播会在午夜十二点开始点名', '电梯只停在不存在的十三层', '下一名死者已经把遗书写好却不记得写过', '供桌香灰倒流，说明规矩已经失效']
  },
  mingmo: {
    surnames: ['顾', '沈', '陆', '许', '方', '纪', '韩', '程', '崔', '梁'],
    givenNames: ['怀砚', '照临', '闻舟', '守微', '砚秋', '从简', '秉烛', '宜娘', '明夷', '问渠'],
    aliases: ['江南账房', '锦衣旧档', '粮船管事', '县衙刑名', '辽东旧卒', '商帮护账人'],
    ages: ['19', '23', '27', '34', '41', '46', '50', '55'],
    roles: ['江南账房幕僚', '锦衣卫旧档房书吏', '盐商护账人', '粮船商帮管事', '逃亡中的县衙刑名师爷', '辽东退役把总'],
    looks: ['清瘦，半旧青布直裰，右手中指有算盘硬茧', '衣袍干净但袖口磨损，账册贴身藏好', '风尘仆仆，靴底沾着驿路泥水', '眼神温和，腰间短刀的柄却磨得发亮', '眉间常有倦色，说话先看门窗'],
    temperaments: ['克制现实', '重名节但懂妥协', '算账极快', '不轻许诺', '遇饥民时心软', '先保活人再谈大义'],
    flaws: ['对旧主家眷心怀愧疚', '相信文书能救人，因此容易低估刀兵', '欠江南商帮一笔人情债', '不愿把无辜者推成替罪人'],
    papers: ['半真半假的路引', '磨损官印拓片', '被火燎过边角的密诏残页', '辽东欠饷粮册抄本', '京师会馆无名短笺', '粮船押运契书'],
    money: ['碎银七两三钱，干粮两日', '碎银不足三两，粮票一张', '账面上有一船粮，手里只有不稳凭证', '欠陆宜娘一笔人情，换来三日周转', '有真账册，无现银'],
    secrets: ['路引身份字段补墨太新，经不起熟手查验', '名字出现在北镇抚司旧档边角批注里', '旧主暴毙后，有人正在追索同一份账册', '密折上的“饷银不在户部”被人故意漏给你', '粮船晚一日不是风雨，是有人压港'],
    goals: ['把密诏残页送到足够有分量的人手里', '查清辽东饷银为何在江南账面上消失', '保住即将被截断的粮船线', '救出被当成替罪人的旧主家眷', '让一城百姓撑过下一轮米价暴涨'],
    pressures: ['河间府驿站夜里查路引，来人像是从京里来的', '京师会馆递出短笺：饷银不在户部', '江南粮船迟了一日，码头米价涨了三成', '山海关军报被改过一笔，阵亡名册和领饷人数对不上']
  },
  yingxiongzhi: {
    surnames: ['卢', '顾', '杨', '秦', '伍', '苏', '陈', '琼', '傅', '言'],
    givenNames: ['云川', '守拙', '问义', '怀书', '照野', '知衡', '承安', '见山', '慎言', '听雨'],
    aliases: ['落第书生', '柳门旧人', '怒苍旧卒后人', '正统军外缘', '顾家门客', '京城书办'],
    ages: ['18', '21', '24', '29', '34', '41', '47'],
    roles: ['落第书生', '边军小校', '江湖镖师', '顾家门客', '怒苍旧卒后人', '京城书办', '华山外门弟子', '正统军粮册抄手'],
    looks: ['青衫洗旧，袖口留着墨痕', '短打沾尘，腰间兵器没有华饰', '身形清瘦，掌心有握笔与握刀并存的薄茧', '衣着端正却不合门第规矩', '风尘仆仆，目光总先看称谓和站位'],
    marks: ['贴身藏着一封未署名旧信', '记得一段不该知道的童谣', '身上有旧军留下的暗号', '在顾家账册里见过自己的名字', '被某位旧友刻意改过称谓'],
    temperaments: ['正直而笨拙', '冷静但不愿把人写成账目', '重义却害怕再次站错队', '嘴硬心软，先问活路再问名分', '谨慎守密，不轻易接受大义'],
    flaws: ['容易因旧情忽视眼前证据', '太想守住具体的人，常与阵营命令冲突', '害怕自己的选择再次牵连旧友', '把沉默当成保护，反而造成误解'],
    factions: ['柳门旧人', '顾家外缘', '怒苍旧部', '正统军外缘', '华山旁支', '无门无派'],
    items: ['未署名旧信', '残缺路引', '旧军暗号木牌', '顾家账页抄本', '一柄无名短刀', '伤药与干粮', '写错又改过的名册', '一枚旧友留下的铜钱'],
    secrets: ['只知道一半的旧案，却被双方当成知情者', '认得某位大人物年轻时的称谓', '曾替人改过一行名册，因此救下一人也害了一人', '知道井谣中的一句真话，但不知道它指向谁'],
    knowns: ['知道眼前人的公开身份，不知道其后期选择', '知道一笔旧账的经手人，不知道真正受益者', '知道两人曾是旧友，不知道决裂的全部原因', '只见过证据残片，尚不能确认完整真相'],
    blindSpots: ['把名分当成事实，容易忽略改名背后的权力', '相信旧友不会再害自己一次', '低估饥饿与军令对人的逼迫', '不知道自己听到的童谣已经被人改过'],
    goals: ['让一名被写进罪册的人活下来', '查清旧友为何改口称呼自己', '把一封旧信送到真正该看的人手里', '在正统军与怒苍冲突前找到第三条活路', '确认一段井谣背后的真实身份'],
    nodes: ['E02 · 乱世文章', 'M01 · 怒苍开山', 'M03 · 正统军诞生', 'A01 · 正统朝多视角', 'B01 · 红螺寺大典', 'W23_01 · 万方有罪开局'],
    pressures: ['旧友即将以新身份入场，称谓先于刀剑改变', '一份名册将在天亮前送入军营', '顾家门外有人等着收回未署名旧信', '怒苍与正统军都要求你先证明自己属于哪一边']
  },
  xianxia: {
    surnames: ['闻', '云', '谢', '洛', '宁', '苏', '晏', '玄', '白', '赤'],
    givenNames: ['雪照', '天明', '清虚', '照尘', '无咎', '抱一', '观星', '长离', '问心', '初玄'],
    aliases: ['无尘子', '玄照真人', '太初道人', '归墟散修', '青云弃徒', '雷泽剑主'],
    ages: ['18', '22', '45', '80', '180', '350', '640', '900'],
    looks: ['白发三千丈，眼眸中有星辰幻灭', '青衣负剑，袖边带着雷火烧痕', '身披黑袍，魔气翻滚，唯有一双血眼清明', '光头无须，肌肉如黄金浇筑', '眉心一点朱砂，行走时周身灵气低鸣'],
    marks: ['本命灵根有裂痕', '识海深处封着半枚天道碎片', '丹田雷纹会在说谎时发亮', '被落雷秘境提前标记', '心魔会借熟人声音说话'],
    temperaments: ['太上忘情', '谨慎苟道', '霸道护短', '外冷内烈', '执念极深', '明知逆天仍要问道'],
    flaws: ['不愿承认自己的欲念', '害怕欠下不可偿还的因果', '修为越快心魔越重', '对师门旧恩难以割舍'],
    realms: ['炼气九层', '筑基大圆满', '金丹初期', '元婴中期', '化神初境', '半步炼虚'],
    martialArts: ['太上感应篇', '天魔策极乐篇', '大日如来金身残篇', '九幽搜魂手', '惊神秘鉴残卷', '雷泽御剑术'],
    styles: ['黄阶功法，根基扎实但上限有限', '玄阶功法，需特定灵根才能圆满', '地阶功法，修行过快会牵动心魔', '天阶功法，需以因果换突破契机', '圣阶残篇，只见开篇不见收束'],
    factions: ['青云道宗', '至魔宫', '大雷音寺', '万妖谷', '散修联盟', '太虚星宫'],
    items: ['残缺古宝照魂铃', '半枚天道碎片', '避劫雷木牌', '未开封秘境图', '灵石三百', '破损飞剑', '封魂玉简', '一炉未成丹'],
    secrets: ['欠青云道宗一桩救命人情', '夺过至魔宫一枚丹药，被真传记名', '曾在秘境里放走一个不该放的人', '本命神通的觉醒条件与欲念有关', '天命榜上出现同命格敌手'],
    goals: ['寻找天道残缺的真相', '补全本命功法残篇', '夺取落雷山脉秘境的第一线机缘', '摆脱圣地与魔宗双重追索', '在天命榜改写前保住自己的道心'],
    pressures: ['落雷秘境三日后开启，入境者会被天雷标记', '天命榜频繁改写，敌手名字与你并列', '圣地愿给庇护，但索要秘境图的一半', '心魔在梦中提前说出你最害怕的真话']
  }
};

export function openingGenreIds() {
  return OPENING_GENRE_OPTIONS.map((option) => option.id);
}

export function getOpeningGenreOption(genre) {
  return OPENING_GENRE_OPTIONS.find((option) => option.id === genre) || OPENING_GENRE_OPTIONS[0];
}

export function createStoryOpeningRandomizer({
  pools = PROLOGUE_RANDOM_POOLS,
  random = () => Math.random()
} = {}) {
  function randomFrom(items) {
    return items[Math.floor(random() * items.length)];
  }

  function prologuePool(genre, key) {
    const genrePools = pools[genre] || pools.xuanhuan || {};
    return genrePools[key] || pools.shared?.[key] || [];
  }

  function rollFromPool(genre, key, fallback = []) {
    const items = prologuePool(genre, key);
    const candidates = items.length ? items : fallback;
    return candidates.length ? randomFrom(candidates) : '';
  }

  function randomMany(items, count) {
    const source = Array.isArray(items) ? [...items] : [];
    const picks = [];
    while (source.length && picks.length < count) {
      const index = Math.floor(random() * source.length);
      picks.push(source.splice(index, 1)[0]);
    }
    return picks;
  }

  function generateSetupName(genre) {
    const aliases = prologuePool(genre, 'aliases');
    if (aliases.length && random() < 0.25) return randomFrom(aliases);
    const surnames = prologuePool(genre, 'surnames');
    const givenNames = prologuePool(genre, 'givenNames');
    if (surnames.length && givenNames.length) return `${randomFrom(surnames)}${randomFrom(givenNames)}`;
    return rollFromPool(genre, 'names', ['无名氏']);
  }

  function setupFieldDescriptor(key, field) {
    return `${key || ''} ${field?.label || ''} ${field?.placeholder || ''}`;
  }

  function composeInventory(genre) {
    const key = genre === 'lingyi'
      ? 'tools'
      : genre === 'mingmo'
        ? 'papers'
        : genre === 'xianxia'
          ? 'items'
          : 'items';
    const candidates = prologuePool(genre, key);
    return randomMany(candidates, 4).join('、') || rollFromPool(genre, key);
  }

  function getScopedSetupFieldValues(field) {
    return Array.isArray(field?.values)
      ? field.values.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  }

  function canRandomizeSetupField(field, { allowSystemFallback = true } = {}) {
    if (getScopedSetupFieldValues(field).length > 1) return true;
    if (Array.isArray(field?.rolls) && field.rolls.filter(Boolean).length > 0) return true;
    return allowSystemFallback;
  }

  function generateSetupFieldValue(genre, key, field, context = {}, { allowSystemFallback = true } = {}) {
    const scopedValues = getScopedSetupFieldValues(field);
    if (scopedValues.length) return randomFrom(scopedValues);
    const scopedDefault = String(field?.defaultValue || '').trim();
    if (scopedDefault) return scopedDefault;
    if (!allowSystemFallback) return String(context[key] || '').trim();

    const descriptor = setupFieldDescriptor(key, field);
    const lowerKey = String(key || '').toLowerCase();

    if (/name|姓名|大名|道名|尊号|字号|代号/.test(descriptor)) {
      return generateSetupName(genre);
    }
    if (/age|年龄|寿元|岁数/.test(descriptor)) {
      return rollFromPool(genre, 'ages', field?.rolls || []);
    }
    if (/gender|性别|阴阳/.test(descriptor)) {
      return rollFromPool(genre, 'genders', field?.rolls || []);
    }
    if (/role|身份/.test(descriptor)) {
      return rollFromPool(genre, 'roles', field?.rolls || []);
    }
    if (/goal|目标|第一目标|问道/.test(descriptor)) {
      return rollFromPool(genre, 'goals', field?.rolls || []);
    }
    if (/appearance|外貌|容貌|衣着|形貌|法相|气味/.test(descriptor)) {
      const look = rollFromPool(genre, 'looks', field?.rolls || []);
      const mark = rollFromPool(genre, 'marks');
      return [look, mark].filter(Boolean).join('，') + '。';
    }
    if (/personality|心性|性格|道心|本性/.test(descriptor)) {
      const temperament = rollFromPool(genre, 'temperaments', field?.rolls || []);
      const flaw = rollFromPool(genre, 'flaws');
      return [temperament, flaw].filter(Boolean).join('；') + '。';
    }
    if (/realm|境界/.test(descriptor)) {
      return rollFromPool(genre, 'realms', field?.rolls || []);
    }
    if (/martial|武学|功法|流派|神通|战技/.test(descriptor)) {
      const art = rollFromPool(genre, 'martialArts', field?.rolls || []);
      const style = rollFromPool(genre, 'styles');
      return style ? `${art}（${style}）` : art;
    }
    if (/faction|门派|出身|宗门|道统/.test(descriptor)) {
      const faction = rollFromPool(genre, 'factions', field?.rolls || []);
      const alias = rollFromPool(genre, 'aliases');
      return alias && faction ? `${alias}，与${faction}有牵连` : faction || alias;
    }
    if (/inventory|tools|paper|treasure|随身|物品|法器|证物|文书|法宝|机缘/.test(descriptor)) {
      return composeInventory(genre);
    }
    if (/money|银粮|储备/.test(descriptor)) {
      return rollFromPool(genre, 'money', field?.rolls || []);
    }
    if (/case|案件/.test(descriptor)) {
      return rollFromPool(genre, 'cases', field?.rolls || []);
    }
    if (/node|节点|阶段|开局卷目/.test(descriptor)) {
      return rollFromPool(genre, 'nodes', field?.rolls || []);
    }
    if (/known|已知信息/.test(descriptor)) {
      return rollFromPool(genre, 'knowns', field?.rolls || []);
    }
    if (/blind|盲区|误解/.test(descriptor)) {
      return rollFromPool(genre, 'blindSpots', field?.rolls || []);
    }
    if (/fear|恐惧|弱点/.test(descriptor)) {
      return rollFromPool(genre, 'flaws', field?.rolls || []);
    }
    if (/secret|risk|karma|mark|隐秘|风险|因果|标记/.test(descriptor)) {
      return rollFromPool(genre, 'secrets', field?.rolls || []);
    }
    if (/relationship|关系/.test(descriptor)) {
      return rollFromPool(genre, 'relationStyles', field?.rolls || []);
    }
    if (/pressure|危机|压力/.test(descriptor)) {
      return rollFromPool(genre, 'pressures', field?.rolls || []);
    }

    if (/paper/.test(lowerKey)) return rollFromPool(genre, 'papers', field?.rolls || []);
    if (/treasure/.test(lowerKey)) return composeInventory(genre);
    if (Array.isArray(field?.rolls) && field.rolls.length) return randomFrom(field.rolls);
    const protagonist = context.name || generateSetupName(genre);
    return `${protagonist}与${rollFromPool(genre, 'secrets')}相关，当前目标是${rollFromPool(genre, 'goals')}。`;
  }

  return {
    canRandomizeSetupField,
    composeInventory,
    generateSetupFieldValue,
    generateSetupName,
    getScopedSetupFieldValues,
    prologuePool,
    randomMany,
    rollFromPool
  };
}

export function createStoryOpeningController({
  state,
  els,
  renderStoryContinuePanel,
  renderStoryProjects,
  renderStoryImportBaseOptions,
  renderCustomStoryBuilder,
  renderStoryCatalogFilters,
  renderStoryPackGrid,
  getAppliedContentPackId,
  getMostRecentSessionSummary,
  setStoryLauncherBackground
} = {}) {
  function renderStoryLauncher() {
    if (!els.storyLauncher) return;
    renderStoryContinuePanel();
    renderStoryProjects();
    renderStoryImportBaseOptions();
    renderCustomStoryBuilder();
    renderStoryCatalogFilters();
    renderStoryPackGrid();
  }

  function openStoryLauncher(options = {}) {
    if (!els.storyLauncher) return;
    renderStoryLauncher();
    const packId = getAppliedContentPackId()
      || getMostRecentSessionSummary()?.packId
      || state.contentPacks?.[0]?.id
      || 'xuanhuan';
    setStoryLauncherBackground(packId);
    els.storyLauncher.classList.remove('is-hidden');
    els.storyLauncher.setAttribute('aria-hidden', 'false');
    document.body.classList.add('story-launcher-open');
    if (options.focusSearch !== false) {
      window.setTimeout(() => els.storyPackSearch?.focus(), 0);
    }
  }

  function closeStoryLauncher() {
    if (!els.storyLauncher) return;
    if (els.storyCustomDialog?.open) els.storyCustomDialog.close();
    els.storyLauncher.classList.add('is-hidden');
    els.storyLauncher.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('story-launcher-open');
  }

  function initializeStoryLauncherVisibility() {
    if (state.storyLauncherInitialized) return;
    state.storyLauncherInitialized = true;
    const messages = Array.isArray(state.session?.messages) ? state.session.messages : [];
    if (!state.session?.storyProjectId && messages.length === 0) {
      openStoryLauncher({ focusSearch: false });
    }
  }

  return {
    closeStoryLauncher,
    initializeStoryLauncherVisibility,
    openStoryLauncher,
    renderStoryLauncher
  };
}
