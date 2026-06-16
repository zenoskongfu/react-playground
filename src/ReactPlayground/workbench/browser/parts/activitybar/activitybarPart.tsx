import { useContext } from 'react'
import {
  ApiOutlined,
  BranchesOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { PlaygroundContext } from '../../../../PlaygroundContext'

const activityItems = [
  { id: 'explorer', label: 'Explorer', icon: FolderOpenOutlined },
  { id: 'search', label: 'Search', icon: SearchOutlined },
  { id: 'source-control', label: 'Source Control', icon: BranchesOutlined },
  { id: 'extensions', label: 'Extensions', icon: ApiOutlined },
  { id: 'ai', label: 'AI Assistant', icon: RobotOutlined },
] as const

export default function ActivitybarPart() {
  const { activeActivity, setActiveActivity } = useContext(PlaygroundContext)

  return (
    <nav className="activity-bar">
      {activityItems.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            className={activeActivity === item.id ? 'active' : ''}
            onClick={() => setActiveActivity(item.id)}
            title={item.label}
          >
            <Icon />
          </button>
        )
      })}
      <button className="settings" title="Settings">
        <SettingOutlined />
      </button>
    </nav>
  )
}
