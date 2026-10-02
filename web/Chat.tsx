import { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import type { Task, TaskStatus, ToolCall } from '../shared/types';
import { Icon, PiMark } from './Icon';

const toolNames: Record<string, string> = { sandbox_read: '读取文件', sandbox_write: '写入文件', sandbox_edit: '修改代码', sandbox_ls: '查看目录', sandbox_bash: '执行命令', browser: '操作浏览器' };
const emptyTaskCopy: Record<TaskStatus, { heading: string; text: string }> = {
  creating: { heading: '正在准备任务电脑…', text: '正在启动环境和浏览器。完成后，可以上传文件或开始任务。' },
  ready: { heading: '任务电脑准备好了。', text: '描述接下来要做的事，让 pi 从这里开始。' },
  running: { heading: 'pi 正在工作…', text: '执行过程会显示在这里，你可以随时停止。' },
  pausing: { heading: '正在暂停当前操作…', text: '等待操作停止后，就可以继续使用任务电脑。' },
  paused: { heading: '任务电脑交给你了。', text: '你可以操作浏览器或编辑代码。归还浏览器后，再让 pi 继续任务。' },
  stopped: { heading: '任务电脑已停止。', text: '项目文件仍然保留。点击「启动环境」，继续这个项目。' },
  error: { heading: '任务环境还未就绪。', text: '查看下方的错误提示后重试，或新建任务重新导入项目。' },
};
function toolDetail(tool: ToolCall) { return String(tool.args.command || tool.args.path || tool.args.url || tool.args.selector || tool.args.action || ''); }

export function Chat({ task, suggest, openProject }: { task?: Task; suggest: (value: string) => void; openProject: () => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const empty = task ? emptyTaskCopy[task.status] : { heading: '你想构建什么？', text: '从一个想法开始。pi 会在独立电脑里编写代码、运行项目，并打开浏览器验证。' };
  const timeline = task ? [
    ...task.messages.filter(item => item.text || item.error).map(item => ({ kind: 'message' as const, item })),
    ...task.tools.map(item => ({ kind: 'tool' as const, item })),
  ].sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt)) : [];
  const signature = `${task?.id}:${task?.messages.map(message => message.text.length).join(',')}:${task?.tools.length}`;
  useEffect(() => {
    if (pinned.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [signature]);
  useEffect(() => { pinned.current = true; }, [task?.id]);
  return <div className="chat-scroll" ref={scroll} onScroll={() => { const element = scroll.current!; pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
    {!timeline.length ? <div className="welcome">
      <PiMark size={40} />
      <h1>{empty.heading}</h1>
      <p>{empty.text}</p>
      {!task && <button className="open-project text-button" onClick={openProject}><Icon name="folder" size={16} />打开已有项目或空白工作区<Icon name="chevron" size={14} /></button>}
      <div className="suggestions" aria-label="任务示例">
        {[
          ['code', '做一个可以直接使用的小应用', '做一个简洁的待办应用，支持添加、完成和删除任务，并保存到浏览器本地。启动后在浏览器里测试。'],
          ['browser', '构建页面，并在浏览器里测试', '做一个摄影作品集网站，支持按分类浏览，适配手机。启动项目并用浏览器检查布局。'],
          ['terminal', '用 Python 处理一份数据', '用 Python 生成一份示例销售数据，做按月份的统计和图表，并写一个网页展示结果。'],
        ].map(([icon, title, prompt]) => <button key={title} onClick={() => suggest(prompt)}><Icon name={icon} /><span>{title}</span><Icon name="chevron" size={14} /></button>)}
      </div>
    </div> : <div className="timeline">{timeline.map(event => event.kind === 'message' ? <article key={event.item.id} className={`chat-message ${event.item.role}`}>
      {event.item.role === 'assistant' && <div className="assistant-byline"><PiMark size={20} /><span>pi</span>{event.item.streaming && <span className="stream-dot" />}</div>}
      <div className="message-content"><Markdown>{event.item.text}</Markdown>{event.item.error && <p className="inline-error" role="alert">{event.item.error}</p>}</div>
    </article> : <details className={`tool-call ${event.item.status}`} key={event.item.id}>
      <summary><Icon name={event.item.status === 'running' ? 'clock' : event.item.status === 'done' ? 'check' : 'alert'} size={15} /><span>{toolNames[event.item.name] || event.item.name}</span><code>{toolDetail(event.item)}</code><Icon name="down" size={13} /></summary>
      <pre>{event.item.output || (event.item.status === 'running' ? '正在执行…' : JSON.stringify(event.item.args, null, 2))}</pre>
    </details>)}</div>}
    {task?.status === 'running' && <div className="agent-working"><span className="stream-dot" />pi 正在处理任务<span className="working-caption">执行过程会显示在这里</span></div>}
    {task?.status === 'paused' && <div className="handoff-note"><Icon name="hand" size={16} /><div>浏览器交给你了。<small>完成操作后，点击「归还浏览器」继续。</small></div></div>}
  </div>;
}
