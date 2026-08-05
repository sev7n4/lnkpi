"""Character turnaround style presets and examples.

Keep in sync with packages/agent/src/prompt-modes/modes/character-turnaround-presets.ts
"""

from __future__ import annotations

from typing import TypedDict


class StylePreset(TypedDict):
    id: str
    label: str
    photography_style: str
    image_type: str
    background: str
    lighting: str
    panel1: str
    panel2: str
    panel3: str
    panel4: str
    material_focus: str
    use_when: str


class StyleExample(TypedDict):
    preset_id: str
    user: str
    assistant: str


CHARACTER_TURNAROUND_STYLE_PRESETS: list[StylePreset] = [
    {
        "id": "photoreal_commercial",
        "label": "写实商业模拍",
        "photography_style": "写实",
        "image_type": "模特定妆参考图 / 角色设定图",
        "background": "白色背景带有细微墙面肌理（非纯白死白）",
        "lighting": (
            "左侧单一自然窗光，面部明暗自然过渡与光衰，右侧可见核心阴影，"
            "无填充光，布料褶皱处有深色环境光遮蔽"
        ),
        "panel1": (
            "近景面部特写（强调鼻翼毛孔、眼下微血管、真实油脂高光与肤质微结构，非塑料反光）"
        ),
        "panel2": (
            "正面全身（重心落于右腿，左膝微屈，双肩不等高，双手自然插兜或不对称手势，放松但有张力）"
        ),
        "panel3": (
            "约45度微侧身（非纯90度侧，展示胸腔厚度），头部回正面向镜头，锁骨与颈肌自然绷起"
        ),
        "panel4": (
            "背面全身（头部微向右偏转露出左耳廓后侧，发丝粗细不一带轻微毛躁，展示背部剪裁与下装背面）"
        ),
        "material_focus": "天然面料织物质感、不规则褶皱、真实皮肤微结构与轻微胶片颗粒",
        "use_when": "电商模拍、品牌lookbook、写实角色定妆、商业摄影参考",
    },
    {
        "id": "fashion_editorial",
        "label": "高定时尚大片",
        "photography_style": "时尚 editorial",
        "image_type": "时尚模特四视图 / 高定造型参考图",
        "background": "浅灰无缝纸背景，无道具干扰",
        "lighting": "顶光+左侧轮廓光，强调服装廓形与面料垂坠，面部保留柔和补光",
        "panel1": "面部与妆发特写（重点展示眼妆、唇色与发型结构）",
        "panel2": "正面全身（一手叉腰或自然垂放，突出服装整体 silhouette）",
        "panel3": "侧面全身（展示腰线、裙/裤摆结构与侧缝细节）",
        "panel4": "背面全身（展示背部设计、拉链/绑带/拖尾等关键结构）",
        "material_focus": "丝绸、薄纱、皮革等高定面料光泽与褶皱",
        "use_when": "时装周造型、奢侈品广告、服装打版参考、Editorial 定妆",
    },
    {
        "id": "cyberpunk_character",
        "label": "赛博朋克角色",
        "photography_style": "电影感写实",
        "image_type": "赛博朋克角色设定图 / 多视图",
        "background": "深灰渐变背景，微弱霓虹环境反光",
        "lighting": "冷色主光+青紫霓虹 rim light，面部一侧有粉色霓虹反射",
        "panel1": "面部特写（重点展示义体接口、眼妆、霓虹反光与机械细节）",
        "panel2": "正面全身（机能风站姿，展示 techwear 层次与装备挂载）",
        "panel3": "侧面全身（展示外骨骼/耳机/武器等侧面结构）",
        "panel4": "背面全身（展示背包、线缆、夹克背部印花或装甲板）",
        "material_focus": "尼龙、碳纤维、金属义体部件与 LED 发光细节",
        "use_when": "科幻游戏角色、赛博朋克 IP、机能风造型、近未来设定",
    },
    {
        "id": "anime_character_sheet",
        "label": "日系动画设定",
        "photography_style": "日系动画",
        "image_type": "动画角色设定图 / 三视图",
        "background": "纯白或浅灰纯色背景，无场景元素",
        "lighting": "均匀平光，无强烈阴影，便于线稿与上色参考",
        "panel1": "面部特写（展示瞳色、发色、表情基准与标志性配饰）",
        "panel2": "正面全身立绘（标准站姿，双手自然下垂，展示完整服装配色）",
        "panel3": "侧面全身立绘（展示发型层次、服装侧摆与鞋型）",
        "panel4": "背面全身立绘（展示后发、披风/书包/武器背面结构）",
        "material_focus": "色块边界清晰、线条干净、服装配色准确",
        "use_when": "二次元角色设定、动画人设、手办原型、VTuber 形象",
    },
    {
        "id": "xianxia_fantasy",
        "label": "古风仙侠",
        "photography_style": "东方唯美写实",
        "image_type": "古风角色设定图 / 仙侠多视图",
        "background": "淡墨色留白背景，轻微云雾晕染，不抢主体",
        "lighting": "柔和散射光，如清晨林间，肤色温润，衣袂有轻微透光感",
        "panel1": "面部特写（重点展示眉眼妆造、发饰、肤质与仙气气质）",
        "panel2": "正面全身（广袖自然垂落或轻握剑柄，展示袍服纹样）",
        "panel3": "侧面全身（展示发冠/簪饰、佩剑/玉佩与衣摆层次）",
        "panel4": "背面全身（展示长发、披风、腰带结饰与袍服后背刺绣）",
        "material_focus": "绸缎、轻纱、金属配饰与刺绣纹样",
        "use_when": "古装影视、仙侠游戏、国风 IP、汉服造型参考",
    },
    {
        "id": "cg_digital_human",
        "label": "3D数字人/CG",
        "photography_style": "3D渲染写实",
        "image_type": "数字人角色 turnaround / CG 设定图",
        "background": "中性灰 HDRI 环境，无具体场景",
        "lighting": "三点布光（主光+补光+轮廓光），呈现 subsurface skin 与 PBR 材质",
        "panel1": "头部特写（展示毛孔级肤质、发型 strand 细节与眼球反射）",
        "panel2": "正面全身 A-pose 或自然站姿（展示绑定比例与服装 fit）",
        "panel3": "侧面全身（展示体型比例、鞋模与侧面装备）",
        "panel4": "背面全身（展示发型背面、服装 rig 友好结构与标识）",
        "material_focus": "PBR 材质、次表面散射皮肤、布料物理模拟",
        "use_when": "虚拟数字人、游戏 CG、元宇宙形象、Unreal/Blender 资产参考",
    },
    {
        "id": "beauty_cosmetic",
        "label": "美妆商业特写",
        "photography_style": "美妆商业",
        "image_type": "美妆模特定妆图 / 妆容四视图",
        "background": "纯白背景，高反射率补光板营造干净肤质",
        "lighting": "环形灯正面补光+顶部柔光，肤色均匀，妆容色彩准确还原",
        "panel1": "极近景面部特写（重点展示底妆、眼妆、唇妆与高光层次）",
        "panel2": "正面半身（展示颈肩线条、耳饰与上装领口搭配）",
        "panel3": "侧面半身（展示轮廓修容、侧发与耳后细节）",
        "panel4": "背面半身或四分之三背侧（展示发型背面结构与发饰）",
        "material_focus": "妆容层次、唇釉光泽、眼影粉质与发丝高光",
        "use_when": "化妆品广告、彩妆教程参考、美妆 KOL 定妆、SKU 色号展示",
    },
    {
        "id": "kpop_idol",
        "label": "K-pop偶像定妆",
        "photography_style": "K-pop 商业写真",
        "image_type": "K-pop 偶像定妆图 / 打歌造型四视图",
        "background": "纯白或浅粉渐变背景，干净无杂物",
        "lighting": "正面柔光+两侧补光，肤质通透，发色与服装色彩饱和准确",
        "panel1": "面部特写（重点展示 idol 妆、美瞳、唇色与标志性发色）",
        "panel2": "正面全身（舞台待机站姿，展示打歌服整体与比例）",
        "panel3": "侧面全身（展示发型层次、耳麦/耳饰与服装侧线）",
        "panel4": "背面全身（展示后发造型、打歌服背部设计与腰带细节）",
        "material_focus": "亮片、皮革、金属扣饰与发色高光",
        "use_when": "K-pop 概念照、偶像周边、打歌舞台造型、饭圈同人设定",
    },
    {
        "id": "streetwear_urban",
        "label": "街头潮流",
        "photography_style": "街头潮流 editorial",
        "image_type": "街头潮模四视图 / 潮流造型参考图",
        "background": "浅灰水泥质感背景或纯色墙，minimal 街头感",
        "lighting": "自然感硬光，略高对比，强调 Oversize 廓形与球鞋细节",
        "panel1": "面部与帽饰特写（展示帽檐、链饰、耳钉与街头妆感）",
        "panel2": "正面全身（ relaxed 站姿，展示卫衣/夹克层次与球鞋）",
        "panel3": "侧面全身（展示侧袋、链饰垂坠与裤型轮廓）",
        "panel4": "背面全身（展示 hood、背部印花与背包）",
        "material_focus": "棉质抓绒、丹宁、皮革球鞋与金属链条",
        "use_when": "潮牌 lookbook、球鞋广告、Supreme/Off-White 风格造型",
    },
    {
        "id": "sportswear_athletic",
        "label": "运动商业模拍",
        "photography_style": "运动商业",
        "image_type": "运动模特四视图 / 运动服 catalog 参考图",
        "background": "纯白背景，高亮度均匀",
        "lighting": "均匀高键光，强调肌肉线条与功能性面料质感，无深阴影",
        "panel1": "面部与发型特写（展示运动妆感、发带/马尾与专注表情）",
        "panel2": "正面全身（运动待机站姿或轻微迈步，展示运动服 fit）",
        "panel3": "侧面全身（展示侧缝线条、跑鞋侧面与姿态）",
        "panel4": "背面全身（展示背部透气网眼、Logo 与跑鞋后跟）",
        "material_focus": "速干面料、网眼、橡胶鞋底与反光条",
        "use_when": "Nike/Adidas 风格 catalog、健身 APP、运动品牌电商主图",
    },
    {
        "id": "steampunk_vintage",
        "label": "蒸汽朋克",
        "photography_style": "维多利亚蒸汽朋克",
        "image_type": "蒸汽朋克角色设定图 / 多视图",
        "background": "暖棕复古工作室背景，轻微齿轮与铜管虚化元素",
        "lighting": "暖色侧光+烛光感补光，金属部件有高光反射",
        "panel1": "面部特写（重点展示护目镜、齿轮义肢接口与维多利亚妆感）",
        "panel2": "正面全身（展示长外套、马甲、齿轮武装带与皮靴）",
        "panel3": "侧面全身（展示蒸汽背包、铜管与侧边怀表链）",
        "panel4": "背面全身（展示披风/长 coat 背面、齿轮箱与皮带结构）",
        "material_focus": "黄铜、皮革、齿轮、蒸汽管道与维多利亚织物",
        "use_when": "蒸汽朋克 IP、复古科幻游戏、维多利亚奇幻角色",
    },
    {
        "id": "gothic_dark",
        "label": "哥特暗黑",
        "photography_style": "哥特时尚",
        "image_type": "哥特角色设定图 / 暗黑造型四视图",
        "background": "纯黑或深紫灰背景，低明度",
        "lighting": "低调光，面部半明半暗，强调轮廓与金属/皮革反光",
        "panel1": "面部特写（重点展示烟熏妆、苍白肤质、唇色与穿刺/颈饰）",
        "panel2": "正面全身（展示 corset/长 coat、蕾丝与尖头皮靴）",
        "panel3": "侧面全身（展示侧链、披风摆与武器/手杖侧面）",
        "panel4": "背面全身（展示后背绑带、披风结构与裙撑/长摆）",
        "material_focus": "蕾丝、漆皮、天鹅绒、银饰与金属扣",
        "use_when": "哥特 Lolita、暗黑系 MV、吸血鬼/奇幻角色、万圣节造型",
    },
    {
        "id": "post_apocalyptic",
        "label": "末世废土",
        "photography_style": "电影感末世",
        "image_type": "末世废土角色设定图 / 多视图",
        "background": "沙尘色渐变背景，轻微废墟 dust 颗粒感",
        "lighting": " harsh 顶光+暖色 dust haze，高对比，强调做旧与伤痕",
        "panel1": "面部特写（重点展示晒斑、伤疤、护目镜痕与风尘妆效）",
        "panel2": "正面全身（展示拼接废土装、护具与武器挂载）",
        "panel3": "侧面全身（展示汽油罐、侧袋、护膝与长枪/工具侧面）",
        "panel4": "背面全身（展示背包、披风补丁与装备带背面）",
        "material_focus": "做旧帆布、皮革补丁、 rust 金属与 dust 颗粒",
        "use_when": "废土游戏（Fallout/Mad Max）、末世影视、生存题材角色",
    },
    {
        "id": "lolita_sweet",
        "label": "洛丽塔甜美系",
        "photography_style": "Sweet Lolita 时尚",
        "image_type": "洛丽塔造型四视图 / 甜美系人设参考图",
        "background": "浅粉或奶白纯色背景，可选轻微蕾丝边框虚化",
        "lighting": "柔和均匀补光，肤色粉嫩，强调蕾丝/蝴蝶结/蛋糕裙层次",
        "panel1": "面部与妆发特写（重点展示 doll 妆、腮红、卷翘睫毛与发饰）",
        "panel2": "正面全身（标准洛丽塔站姿，展示蛋糕裙、围裙与堆叠袜）",
        "panel3": "侧面全身（展示侧裙撑轮廓、Bonnet 侧面与鞋型）",
        "panel4": "背面全身（展示大蝴蝶结、后背绑带与裙撑背面）",
        "material_focus": "蕾丝、缎带、荷叶边、蛋糕层叠与玛丽珍鞋漆皮",
        "use_when": "Sweet Lolita 时装、日系甜美系、BJD 娃衣参考、少女向 IP",
    },
    {
        "id": "military_tactical",
        "label": "军事战术",
        "photography_style": "战术军事写实",
        "image_type": "军事角色设定图 / 战术装备四视图",
        "background": "深橄榄灰或沙色纯色背景，无场景",
        "lighting": "均匀实用光，强调装备细节与面料耐磨质感，低戏剧感",
        "panel1": "面部特写（重点展示战妆/迷彩油彩、护目镜痕与通信耳机）",
        "panel2": "正面全身（战术站姿，展示背心、弹匣袋与武器挂载）",
        "panel3": "侧面全身（展示侧袋、枪套、对讲机与护膝侧面）",
        "panel4": "背面全身（展示背包、武器背挂与背心背面 Molle 系统）",
        "material_focus": "Cordura 尼龙、迷彩织物、凯夫拉、金属扣具",
        "use_when": "FPS/TPS 游戏、军事题材影视、战术装备 catalog、Cosplay 参考",
    },
    {
        "id": "bridal_formal",
        "label": "婚纱礼服",
        "photography_style": "婚纱商业写真",
        "image_type": "婚纱/礼服四视图 / bridal 造型参考图",
        "background": "纯白或浅香槟色无缝背景，浪漫干净",
        "lighting": "柔和漫射光+轮廓光，肤色通透，白色礼服层次不溢出",
        "panel1": "面部与妆发特写（重点展示 bridal 妆、头纱/发饰与耳环）",
        "panel2": "正面全身（优雅站姿，展示礼服整体廓形与拖尾前片）",
        "panel3": "侧面全身（展示腰线、侧裙摆层次与高跟鞋）",
        "panel4": "背面全身（重点展示拖尾、露背设计与头纱背面）",
        "material_focus": "婚纱缎面、蕾丝、头纱透明度与珍珠/水晶饰",
        "use_when": "婚纱 catalog、晚宴礼服、婚礼摄影参考、Formal wear 造型",
    },
    {
        "id": "western_cowboy",
        "label": "西部牛仔",
        "photography_style": "西部电影感写实",
        "image_type": "西部牛仔角色设定图 / 多视图",
        "background": "暖棕土黄色渐变，轻微 dust 与 horizon 暗示",
        "lighting": "golden hour 侧光，暖调，强调皮革与牛仔布纹理",
        "panel1": "面部特写（重点展示晒痕、胡茬、宽檐帽阴影与牛仔眼神）",
        "panel2": "正面全身（展示牛仔夹克、皮带扣、牛仔裤与牛仔靴）",
        "panel3": "侧面全身（展示枪套、马刺、侧袋与宽檐帽侧面）",
        "panel4": "背面全身（展示披风/夹克背面、皮带与靴跟）",
        "material_focus": "做旧牛仔布、皮革、黄铜扣、马刺与宽檐毡帽",
        "use_when": "西部片、荒野题材游戏、美式复古、Cowboy/Cowgirl 角色",
    },
    {
        "id": "stylized_3d_cartoon",
        "label": "皮克斯3D卡通",
        "photography_style": "皮克斯风格3D渲染",
        "image_type": "风格化3D角色 turnaround / 卡通设定图",
        "background": "中性浅灰或柔和渐变，无具体场景",
        "lighting": "三点布光，柔和阴影，强调体积感与 subsurface 卡通皮肤",
        "panel1": "头部特写（展示夸张但讨喜的五官比例、肤质与发型 clump）",
        "panel2": "正面全身（展示 stylized 比例、服装色块与姿态）",
        "panel3": "侧面全身（展示侧面 silhouette 与装备）",
        "panel4": "背面全身（展示发型/帽子背面与服装结构）",
        "material_focus": "卡通 PBR、布料 fold、圆润边缘与饱和配色",
        "use_when": "Pixar/Disney 风3D、动画电影角色、儿童向3D IP、盲盒形象",
    },
    {
        "id": "illustration_watercolor",
        "label": "水彩绘本插画",
        "photography_style": "水彩绘本插画",
        "image_type": "绘本角色设定图 / 插画 turnaround",
        "background": "留白纸感或轻微水彩晕染，无照片级场景",
        "lighting": "平光插画感，靠水彩明暗而非摄影布光",
        "panel1": "面部特写（展示水彩晕染、线稿与柔和表情）",
        "panel2": "正面全身（展示服装配色与水彩叠色）",
        "panel3": "侧面全身（展示侧面线稿与笔触感）",
        "panel4": "背面全身（展示后发/披风背面与纸张留白）",
        "material_focus": "水彩纸纹理、颜料水痕、铅笔线稿与柔和边缘",
        "use_when": "儿童绘本、文艺插画 IP、gentle fantasy、书籍角色设定",
    },
    {
        "id": "chibi_kawaii",
        "label": "Q版萌系",
        "photography_style": "Q版萌系插画",
        "image_type": "Q版角色设定图 / chibi 三视图",
        "background": "纯白或浅 pastel 纯色，可选轻微星星/爱心装饰",
        "lighting": "均匀平光，无写实阴影，强调可爱圆润感",
        "panel1": "大头特写（2-3头身比例，重点展示超大眼睛、腮红与萌系表情）",
        "panel2": "正面全身 Q 版（头身比约1:1~1:2，短手短脚，展示完整配色）",
        "panel3": "侧面全身 Q 版（展示侧发、小背包与圆润侧面轮廓）",
        "panel4": "背面全身 Q 版（展示后发、披风/尾巴/背包背面）",
        "material_focus": "圆润线条、饱和 pastel 配色、简化细节与大眼高光",
        "use_when": "Q版/Q萌/chibi、表情包、贴纸、手游萌系角色、二头身周边",
    },
]


def format_style_presets_for_system() -> str:
    lines = []
    for p in CHARACTER_TURNAROUND_STYLE_PRESETS:
        lines.append(
            f"- {p['label']}（{p['id']}）：{p['use_when']}；"
            f"风格={p['photography_style']}；背景={p['background']}；光线={p['lighting']}"
        )
    return "\n".join(lines)


CHARACTER_TURNAROUND_EXAMPLE_USERS = [
    "帮我生成一个中年男性复古英伦风模特的四视图提示词",
    "生成高定时尚女模四视图，黑色晚礼服",
    "赛博朋克女黑客角色设定四视图",
    "日系动画女高中生角色三视图设定",
    "古风仙侠白衣剑客角色设定四视图",
    "3D数字人商务女性 turnaround 设定",
    "美妆模特妆容四视图，春季桃花妆",
    "K-pop男团偶像打歌造型四视图，黑红概念",
    "街头潮流男模四视图，Oversize 卫衣球鞋",
    "运动品牌女模跑步服四视图",
    "蒸汽朋克女性发明家角色四视图",
    "哥特暗黑女吸血鬼角色设定四视图",
    "末世废土女幸存者角色四视图",
    "Sweet Lolita 粉色蛋糕裙少女四视图",
    "现代特种兵男性战术装备四视图",
    "新娘白色婚纱四视图设定",
    "西部牛仔男性角色四视图",
    "皮克斯风格3D卡通男孩角色 turnaround",
    "水彩绘本风小狐狸精灵角色插画四视图",
    "Q版萌系猫耳少女 chibi 三视图",
]
