# MCP Server Design for Scout Coach Quest System

## Overview
A Model Context Protocol (MCP) server to provide persistent state management for Will's Scout Coach quest system, tracking PC building progress and merit badge completion across conversations and platforms (Claude Projects → LibreChat migration).

## Core Purpose
- Maintain QUEST STATE across sessions without requiring file uploads
- Enable portable tracking between Claude Projects and LibreChat (Tier 2)
- Provide lightweight, friction-free state persistence
- Support both merit badge requirements and hardware acquisition milestones

## Server Specification

### Server Name
`scout-quest-tracker`

### Resources Exposed

#### 1. Quest State Resource
**URI:** `quest://state`
**MIME Type:** `application/json`
**Description:** Current quest progress including earned money, unlocked components, and merit badge completion

**Schema:**
```json
{
  "metadata": {
    "scout_name": "Will",
    "troop": "2024",
    "quest_start_date": "YYYY-MM-DD",
    "last_updated": "ISO-8601 timestamp"
  },
  "finances": {
    "total_earned": 0.00,
    "total_spent": 0.00,
    "current_balance": 0.00,
    "chore_history": [
      {
        "date": "YYYY-MM-DD",
        "chore": "description",
        "amount": 0.00
      }
    ]
  },
  "pc_components": {
    "cpu": {
      "unlocked": false,
      "unlock_cost": 200.00,
      "purchased": false,
      "actual_cost": null,
      "model": null,
      "notes": null
    },
    "gpu": {
      "unlocked": false,
      "unlock_cost": 300.00,
      "purchased": false,
      "actual_cost": null,
      "model": null,
      "notes": null
    },
    "motherboard": {
      "unlocked": false,
      "unlock_cost": 150.00,
      "purchased": false,
      "actual_cost": null,
      "model": null,
      "notes": null
    },
    "ram": {
      "unlocked": false,
      "unlock_cost": 80.00,
      "purchased": false,
      "actual_cost": null,
      "model": null,
      "notes": null
    },
    "storage": {
      "unlocked": false,
      "unlock_cost": 100.00,
      "purchased": false,
      "actual_cost": null,
      "model": null,
      "notes": null
    },
    "psu": {
      "unlocked": false,
      "unlock_cost": 100.00,
      "purchased": false,
      "actual_cost": null,
      "model": null,
      "notes": null
    },
    "case": {
      "unlocked": false,
      "unlock_cost": 70.00,
      "purchased": false,
      "actual_cost": null,
      "model": null,
      "notes": null
    }
  },
  "merit_badges": {
    "personal_management": {
      "status": "not_started",
      "counselor_assigned": false,
      "counselor_name": null,
      "scoutbook_blue_card": null,
      "requirements": {
        "1": {"completed": false, "date": null, "notes": null},
        "2": {"completed": false, "date": null, "notes": null},
        "3": {"completed": false, "date": null, "notes": null},
        "4": {"completed": false, "date": null, "notes": null},
        "5": {"completed": false, "date": null, "notes": null},
        "6": {"completed": false, "date": null, "notes": null},
        "7": {"completed": false, "date": null, "notes": null},
        "8": {"completed": false, "date": null, "notes": null},
        "9": {"completed": false, "date": null, "notes": null},
        "10": {"completed": false, "date": null, "notes": null}
      }
    },
    "family_life": {
      "status": "not_started",
      "counselor_assigned": false,
      "counselor_name": null,
      "scoutbook_blue_card": null,
      "requirements": {
        "1": {"completed": false, "date": null, "notes": null},
        "2": {"completed": false, "date": null, "notes": null},
        "3": {"completed": false, "date": null, "notes": null},
        "4": {"completed": false, "date": null, "notes": null},
        "5": {"completed": false, "date": null, "notes": null},
        "6": {"completed": false, "date": null, "notes": null},
        "7": {"completed": false, "date": null, "notes": null}
      }
    }
  },
  "milestones": {
    "first_component_unlocked": null,
    "first_component_purchased": null,
    "first_merit_badge_requirement": null,
    "personal_management_completed": null,
    "family_life_completed": null,
    "pc_build_completed": null
  }
}
```

### Tools Provided

#### 1. `update_finances`
**Description:** Record chore earnings and update balance
**Parameters:**
- `chore_description` (string, required): What chore was completed
- `amount` (number, required): Amount earned in USD
- `date` (string, optional): Date completed (defaults to today)

**Returns:** Updated balance and newly unlocked components (if any)

#### 2. `unlock_component`
**Description:** Mark a component as unlocked when balance threshold is reached
**Parameters:**
- `component` (enum, required): cpu|gpu|motherboard|ram|storage|psu|case

**Returns:** Success confirmation and updated component status

#### 3. `purchase_component`
**Description:** Record actual component purchase with details
**Parameters:**
- `component` (enum, required): cpu|gpu|motherboard|ram|storage|psu|case
- `actual_cost` (number, required): Actual purchase price
- `model` (string, required): Specific model purchased
- `notes` (string, optional): Purchase notes/decisions made

**Returns:** Updated finances and component status

#### 4. `update_merit_badge`
**Description:** Update merit badge requirement completion
**Parameters:**
- `badge` (enum, required): personal_management|family_life
- `requirement` (string, required): Requirement number (1-10 for PM, 1-7 for FL)
- `completed` (boolean, required): Completion status
- `notes` (string, optional): Work completed notes

**Returns:** Updated merit badge status

#### 5. `assign_counselor`
**Description:** Record counselor assignment and Scoutbook blue card initiation
**Parameters:**
- `badge` (enum, required): personal_management|family_life
- `counselor_name` (string, required): Counselor's name
- `scoutbook_blue_card` (string, optional): Virtual blue card ID from Scoutbook Plus

**Returns:** Updated counselor assignment status

#### 6. `get_quest_summary`
**Description:** Get formatted progress summary
**Parameters:** None

**Returns:** Human-readable quest progress including:
- Current balance and earned total
- Unlocked vs locked components
- Merit badge progress percentages
- Next suggested actions

### Prompts Provided

#### 1. `quest-status`
**Description:** Generate formatted quest status report
**Arguments:** None
**Template:** Reads quest state and formats comprehensive progress report

#### 2. `next-steps`
**Description:** Suggest next actionable steps based on current state
**Arguments:** None
**Template:** Analyzes state to recommend priority tasks

## Implementation Details

### Storage Backend
- **Recommended:** SQLite database for persistence
- **Alternative:** JSON file with atomic writes and file locking
- **Location:** User-configurable data directory

### State Initialization
- First connection creates empty quest state with default values
- Metadata captures initial setup (scout name, troop, start date)
- All numeric values initialize to 0.00 or false

### Validation Rules
1. Cannot unlock component if balance < unlock_cost
2. Cannot purchase component unless unlocked = true
3. Cannot mark requirement complete without counselor assigned
4. All currency values must be non-negative
5. Dates must be valid ISO-8601 format

### Migration Support
- Export tool: Generate complete JSON dump for transfer
- Import tool: Load existing state from JSON file
- Version field in metadata for schema evolution

## Usage Pattern

### Scout Coach System Integration
The system prompt should reference this MCP server:

```
You have access to Will's quest state via the scout-quest-tracker MCP server.
Always check current state before providing guidance.
Update state immediately when Will reports progress.
Use get_quest_summary at session start to orient yourself.
```

### Typical Workflow
1. Session starts → Scout Coach calls `get_quest_summary`
2. Will reports chore → Coach calls `update_finances`
3. Component unlocked → Coach celebrates milestone
4. Merit badge work → Coach calls `update_merit_badge`
5. Session ends → State automatically persisted

## Configuration File

**~/.config/scout-quest-tracker/config.json:**
```json
{
  "storage_path": "~/.local/share/scout-quest-tracker/quest.db",
  "backup_enabled": true,
  "backup_path": "~/.local/share/scout-quest-tracker/backups/",
  "max_backups": 10,
  "log_level": "INFO"
}
```

## Security Considerations
- Read-only access for Scout (Will) via Claude
- Write access requires adult supervision trigger
- No deletion of historical chore records
- Backup before any state modifications
- Audit log of all state changes with timestamps

## Future Enhancements (Post-MVP)
- Multi-scout support for troop-wide deployment
- Achievement badges/awards system
- Integration with Scoutbook Plus API (if available)
- Parent dashboard for oversight
- Export to PDF progress reports

---

**Migration Path:**
1. Deploy MCP server locally
2. Test with Claude Desktop + MCP
3. Configure LibreChat to use same MCP server
4. Validate state persistence across platforms
5. Document any platform-specific quirks