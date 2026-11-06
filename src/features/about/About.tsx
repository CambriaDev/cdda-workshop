import { ExternalLink, Mail, UserRound } from 'lucide-react';
import { useApp } from '../../app/context';

const repositoryUrl = 'https://github.com/CambriaDev/cdda-workshop';
const authorUrl = 'https://github.com/CambriaDev';
const authorEmail = 'i@cambria.cam';
const licenseUrl = 'https://github.com/CambriaDev/cdda-workshop/blob/main/LICENSE';
const cddaUrl = 'https://github.com/CleverRaven/Cataclysm-DDA';

const modCredits: { directory: string; repository?: string; note?: string }[] = [
  { directory: 'Arcana' },
  { directory: 'Cataclysm-DDA-Touhou-Expansion', repository: 'https://github.com/RedMisao/Cataclysm-DDA-Touhou-Expansion' },
  { directory: 'Cataclysm-DDA-Touhou-Mod', repository: 'https://github.com/RedMisao/Cataclysm-DDA-Touhou-Mod', note: 'fork' },
  { directory: 'CulinaryDaysAhead' },
  { directory: 'Dino_Mad_Science' },
  { directory: 'Dorf_Life' },
  { directory: 'Kawaii_New1.1' },
  { directory: 'Lighter_Weariness' },
  { directory: 'MagicRevampAdditions' },
  { directory: 'Medieval_Mod_Reborn' },
  { directory: 'Mining_Mod' },
  { directory: 'MMA_Mods_Extension' },
  { directory: 'MST_Extra' },
  { directory: 'No_Fungi' },
  { directory: 'NPC_VOICEROIDs' },
  { directory: 'PM_World' },
  { directory: 'Tankmod_Revived' },
  { directory: 'blazemod' },
  { directory: 'no_cbm_slots' },
  { directory: 'VOICEROID+Ex_mod' },
  { directory: 'World_On_Fire' },
  { directory: 'nocts_cata_mod_DDA', repository: 'https://github.com/Noctifer-de-Mortem/nocts_cata_mod' },
  { directory: 'pixels_fuckery' },
  { directory: 'secronom' },
  { directory: 'secronom_lore_expansion' },
  { directory: 'vamp_stuff' },
  { directory: 'vamp_stuff_arcana' },
  { directory: 'whaleys-hair-and-tattoo' },
];

export function About() {
  const { t } = useApp();

  return <section className="about-page" aria-labelledby="about-title">
    <header className="about-heading">
      <span className="eyebrow">CDDA WORKSHOP · 0.3.0</span>
      <h1 id="about-title">{t('关于 CDDA Workshop', 'About CDDA Workshop')}</h1>
      <p>{t('为 Cataclysm: Dark Days Ahead 打造的本地优先工坊。', 'A local-first workshop for Cataclysm: Dark Days Ahead.')}</p>
    </header>

    <div className="about-grid">
      <article className="about-card about-intro">
        <span className="about-card-label">{t('项目介绍', 'ABOUT THE PROJECT')}</span>
        <h2>{t('在本地整理你的废土工具', 'Your workshop, on your device')}</h2>
        <p>{t('CDDA Workshop 是基于本地 CDDA 0.I-1 数据的独立、非官方、纯静态 React + TypeScript 编辑器，提供载具工坊、只读附近车辆查询和原生角色模板导出。数据与文件都由浏览器在本机处理，不会上传或自动写回游戏存档。', 'CDDA Workshop is an independent, unofficial, static React + TypeScript editor built around local CDDA 0.I-1 data. It includes a vehicle workshop, read-only nearby-vehicle lookup, and native character-template export. Data and files are processed locally in your browser—nothing is uploaded or written back to game saves.')}</p>
        <p className="about-caveat">{t('请注意：目前尚未完成实际游戏导入验收；自动化测试不代表游戏加载保证。', 'Please note: importing into the actual game has not yet been validated. Automated tests do not guarantee in-game loading.')}</p>
      </article>

      <article className="about-card about-project-link">
        <span className="about-card-label">{t('项目地址', 'PROJECT REPOSITORY')}</span>
        <a className="about-link" href={repositoryUrl} target="_blank" rel="noreferrer">
          <span><strong>GitHub</strong><small>CambriaDev / cdda-workshop</small></span>
          <ExternalLink size={18} aria-hidden="true" />
        </a>
        <p>{t('查看源码、项目文档与更新。', 'Explore the source, documentation, and updates.')}</p>
      </article>

      <article className="about-card about-author">
        <span className="about-card-label">{t('作者', 'AUTHOR')}</span>
        <a className="about-link" href={authorUrl} target="_blank" rel="noreferrer">
          <span className="about-link-icon"><UserRound size={17} aria-hidden="true" /></span>
          <span><strong>CambriaDev</strong><small>{t('GitHub 用户', 'GitHub profile')}</small></span>
          <ExternalLink size={16} aria-hidden="true" />
        </a>
        <a className="about-email" href={`mailto:${authorEmail}`}><Mail size={15} aria-hidden="true" />{authorEmail}</a>
      </article>

      <article className="about-card about-license">
        <span className="about-card-label">{t('开源协议', 'OPEN SOURCE LICENSE')}</span>
        <a className="about-link" href={licenseUrl} target="_blank" rel="noreferrer">
          <span><strong>MIT License</strong><small>{t('应用代码', 'Application code')}</small></span>
          <ExternalLink size={18} aria-hidden="true" />
        </a>
        <p>{t('CDDA 游戏数据遵循 CC BY-SA 3.0；第三方依赖遵循各自许可。', 'CDDA game data is licensed under CC BY-SA 3.0; third-party dependencies retain their respective licenses.')}</p>
      </article>

      <article className="about-card about-credits">
        <span className="about-card-label">{t('源码致谢', 'SOURCE ACKNOWLEDGMENTS')}</span>
        <p>{t('本项目使用并改编了 Cataclysm-DDA 的部分源码与游戏数据。感谢上游项目及模组作者的创作。', 'This project uses and adapts portions of Cataclysm-DDA source code and game data. Thanks to the upstream project and mod authors.')}</p>
        <a className="about-upstream" href={cddaUrl} target="_blank" rel="noreferrer"><span>CleverRaven / Cataclysm-DDA</span><ExternalLink size={14} aria-hidden="true" /></a>
        <p className="about-credit-note">{t('第三方模组清单用于致谢与来源识别；不代表其内容均随本项目分发，许可及分发状态以各模组审计结果为准。', 'The third-party mod list is provided for acknowledgment and source identification; it does not mean their content is distributed with this project. See the audit results for each mod’s license and distribution status.')}</p>
        <details className="about-mod-list">
          <summary>{t('查看 mod_repo 模组清单（28）', 'View mod_repo mod list (28)')}</summary>
          <ul>
            {modCredits.map(({ directory, repository, note }) => <li key={directory}>
              {repository
                ? <><a href={repository} target="_blank" rel="noreferrer">{directory}</a>{note && <small> ({t('分支仓库', 'fork')})</small>}</>
                : <span>{directory}</span>}
            </li>)}
          </ul>
        </details>
      </article>
    </div>
  </section>;
}
