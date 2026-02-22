# Scout-Quest: BSA Merit Badge Requirements & Advancement Reference

> **Purpose:** This document is a structured reference for designing an MCP server interface that guides a Scout through the Personal Management and Family Life merit badges, using a personally meaningful goal (e.g., building a gaming PC) as the driving motivation. The AI agent must understand these requirements **to the word** because BSA policy is explicit: requirements must be met "as stated—no more and no less."
>
> **Sources:** All requirements are from the official Scouting America Merit Badge Hub (scouting.org), current as of February 2026. Advancement policies are from the Guide to Advancement 2025 (BSA Publication 33088). Merit badge counseling guidance is from "A Guide for Merit Badge Counseling" (BSA Publication 512-065).
>
> **Last verified:** February 21, 2026

---

## Table of Contents

1. [Critical Advancement Principles](#1-critical-advancement-principles)
2. [Family Life Merit Badge — Full Requirements](#2-family-life-merit-badge--full-requirements)
3. [Personal Management Merit Badge — Full Requirements](#3-personal-management-merit-badge--full-requirements)
4. [Guide to Advancement — Key Policies for Merit Badges](#4-guide-to-advancement--key-policies-for-merit-badges)
5. [Merit Badge Counseling Process](#5-merit-badge-counseling-process)
6. [Troop 2024 Process & Modifications](#6-troop-2024-process--modifications)
7. [Quest Design Philosophy](#7-quest-design-philosophy)
8. [Per-Scout Configuration Schema](#8-per-scout-configuration-schema)
9. [Quest Goal Archetypes & Requirement Mapping](#9-quest-goal-archetypes--requirement-mapping)
10. [Agent Behavior & Pacing](#10-agent-behavior--pacing)
11. [MCP Server Data Model](#11-mcp-server-data-model)

---

## 1. Critical Advancement Principles

These principles MUST govern the AI agent's behavior at all times:

### 1.1 No More, No Less

> "You are expected to meet the requirements as they are stated—no more and no less. You must do exactly what is stated in the requirements. If it says 'show or demonstrate,' that is what you must do. Just telling about it isn't enough. The same thing holds true for such words as 'make,' 'list,' 'in the field,' and 'collect,' 'identify,' and 'label.'"
> — Scouting America, Merit Badge Hub

**MCP implication:** The agent must never tell a Scout they've completed a requirement unless the Scout has done exactly what the requirement says. Conversely, the agent must never add requirements that don't exist.

### 1.2 The Scout Does the Work

> "Each Scout must individually and personally complete all requirements."
> — Guide for Merit Badge Counseling (512-065)

**MCP implication:** The agent guides, coaches, and motivates—but the Scout must do the actual work. The agent should never write content FOR the Scout (e.g., drafting emails, writing budget plans). It should help the Scout understand what's needed and review/improve what the Scout produces.

### 1.3 Advancement Is a Method, Not an End

> "Advancement is simply a means to an end, not an end in itself. It is one of several methods designed to help unit leadership carry out the aims and mission of Scouting America."
> — Guide to Advancement 2025, Section 2.0.0.1

> "Personal growth is the primary goal. Scouting skills—what a young person learns to do—are important, but not as important as the primary goal of personal growth achieved through participating in a unit program."
> — Guide to Advancement 2025, Section 2.0.0.3

**MCP implication:** The agent should emphasize learning and growth, not just checking boxes. When a Scout is working through budget tracking, for example, the agent should help them understand WHY budgeting matters, not just fill in numbers.

### 1.4 The Aims of Scouting

Every Scouting activity moves young people toward these basic aims:
- **Character development**
- **Citizenship training**
- **Leadership**
- **Mental and physical fitness**

### 1.5 Experiential Learning

> "Experiential learning is the key: Exciting and meaningful activities are offered, and education happens. Learning comes from doing. Rushing a Scout through requirements to obtain a badge is not the goal."
> — Guide to Advancement 2025, Section 2.0.0.2

### 1.6 Once Signed Off, It's Done

> "Once a Scout has been tested and signed off by someone approved to do so, the requirement has been met and cannot be rescinded."
> — Guide to Advancement 2025, Section 4.2.1.2

### 1.7 Unauthorized Changes Prohibited

> "No council, committee, district, unit, or individual has the authority to add to, or subtract from, advancement requirements, or deviate from policies in this publication."
> — Guide to Advancement 2025, Policy on Unauthorized Changes

### 1.8 Technology-Based Tools in Advancement

> Section 5.0.8.0 of the 2025 Guide to Advancement includes updated policy on group/online instruction and use of artificial intelligence in advancement.

**MCP implication:** The agent should be aware that BSA has acknowledged AI as part of the advancement landscape. The agent is a tool to help the Scout learn and organize—not a replacement for the Scout's own effort.

---

## 2. Family Life Merit Badge — Full Requirements

**Status:** Eagle Required  
**Requirements updated:** 2025 (2025 Scouting America Requirements, Publication 33216)  
**Source:** https://www.scouting.org/merit-badges/family-life/

> **Note:** The official merit badge pamphlet is free and downloadable from: https://filestore.scouting.org/filestore/Merit_Badge_ReqandRes/Pamphlets/Family%20Life.pdf

### Overview

The family is the basic unit of society and is important to both individuals and communities. The world is rapidly changing, making today's society much more complex than ever before. As Scouts earn this merit badge, they will realize why it is important to know more about family life and how to strengthen their families.

### Requirement 1

Prepare an outline on what a family is and discuss this with your counselor. Tell why families are important to individuals and to society. Discuss how the actions of one member can affect other members.

### Requirement 2

List several reasons why you are important to your family and discuss this with your parent or guardian and with your counselor.

### Requirement 3

Prepare a list of your regular home duties or chores (at least five) and do them for 90 days. Keep a record of how often you do each of them. Discuss with your counselor the effect your chores had on your family.

> **KEY DETAIL:** This is a 90-day tracking requirement. The Scout must:
> - List at least 5 regular home duties or chores
> - Actually perform them for 90 consecutive days
> - Keep a written/digital record of frequency
> - Discuss the impact with their counselor
>
> **MCP implication:** This is the longest-duration requirement across both badges. The agent must track start date, chore list, and completion records over the full 90-day period. This requirement should be started FIRST to run in parallel with other work.

### Requirement 4

With the approval of your parent or guardian and your counselor, decide on and carry out an individual project that you would do around the home that would benefit your family. After completion, discuss the objective or goal and the results of the project with your family and then your counselor.

> **KEY DETAIL:** This requires:
> 1. Prior approval from BOTH parent/guardian AND counselor BEFORE starting
> 2. The project must be an INDIVIDUAL project (not a family group project—that's Req 5)
> 3. It must be done "around the home"
> 4. It must "benefit your family"
> 5. After completion: discuss objective/goal AND results with family THEN counselor
>
> **MCP implication for scout-quest:** If the Scout's goal is building a gaming PC, this requirement could potentially be satisfied if the PC benefits the family (e.g., family computer, shared gaming station) and the project is done at home. The agent should help the Scout frame this appropriately and get counselor approval BEFORE starting.

### Requirement 5

Plan and carry out a project that involves the participation of your family. After completing the project, discuss the following with your counselor:

- **(a)** The objective or goal of the project
- **(b)** How individual members of your family participated
- **(c)** The results of the project

> **KEY DETAIL:** This is distinct from Req 4:
> - This is a FAMILY project, not individual
> - Family members must PARTICIPATE (not just observe)
> - Must discuss all three sub-items (a), (b), (c) with counselor

### Requirement 6

Do the following:

> **Note from BSA:** Some of the issues surrounding requirement 6 for the family meeting could be considered of a personal nature. Use discretion when reviewing this requirement with the Scout. Discussion of each of these subjects will very likely carry over to more than one family meeting.

- **(a)** Discuss with your counselor how to plan and carry out a family meeting.

- **(b)** Prepare a meeting agenda that includes the following topics, review it with your parent or guardian, and then carry out one or more family meetings:

  - **(1)** How living the principles of the Scout Oath and Scout Law contributes to your family life
  - **(2)** The greatest dangers and addictions facing youth in today's society (examples include mental health challenges, use of tobacco products, alcohol, or drugs and other items such as debts, social media, etc.)
  - **(3)** Discuss with a parent or guardian how bodily changes can affect the choices you make as you physically and mentally mature.
  - **(4)** Personal and family finances
  - **(5)** A crisis situation within your family and whom you can turn to for support during these situations.
  - **(6)** The effect of technology on your family
  - **(7)** Good etiquette and manners

> **KEY DETAIL:** The Scout must:
> 1. First discuss with counselor how to plan the meetings
> 2. Prepare an agenda covering ALL 7 topics
> 3. Review the agenda with parent/guardian
> 4. Carry out the family meeting(s) — can be one or more meetings
> 5. All 7 topics must be covered, but they can span multiple meetings
>
> **MCP implication:** Topic (4) "Personal and family finances" directly connects to the Personal Management badge. The agent can help the Scout prepare for this discussion using insights from their budgeting work. Topic (6) "The effect of technology" could naturally connect to the gaming PC project.

### Requirement 7

Discuss with your counselor your understanding of what makes an effective parent or guardian and why, and your thoughts on the parent or guardian's role and responsibilities in the family.

---

## 3. Personal Management Merit Badge — Full Requirements

**Status:** Eagle Required  
**Requirements last revised:** January 1, 2024  
**Source:** https://www.scouting.org/merit-badges/personal-management/

> **Note:** The official merit badge pamphlet is free and downloadable from: https://filestore.scouting.org/filestore/Merit_Badge_ReqandRes/Pamphlets/Personal%20Management.pdf

> **NOTE from BSA:** Always be sure to have proper permission before using the internet. It is strongly advised that Scouts view the Personal Safety Awareness videos before starting work. Find details at www.scouting.org/training/youth-protection/scouts-bsa

### Overview

Personal management is about mapping a plan for your life that will involve setting short-range and long-range goals and investigating different ways to reach those goals. Education, training, and experience all help make your goals become a reality. To achieve your goals, you will choose the best path and make a commitment to it, while remaining flexible enough to deal with changes and new opportunities.

### Requirement 1

Do the following:

- **(a)** Choose an item that your family might want to purchase that is considered a major expense.

- **(b)** Write a plan that tells how your family would save money for the purchase identified in requirement 1(a).
  - **(1)** Discuss the plan with your counselor.
  - **(2)** Discuss the plan with your family.
  - **(3)** Discuss how other family needs must be considered in this plan.

- **(c)** Develop a written shopping strategy for the purchase identified in requirement 1(a).
  - **(1)** Determine the quality of the item or service (using consumer publications or rating systems.)
  - **(2)** Comparison shop for the item. Find out where you can buy the item for the best price. (Provide prices from at least two different price sources.) Call around; study ads. Look for a sale or discount coupon. Consider alternatives. Can you buy the item used? Should you wait for a sale?

> **KEY DETAIL — THIS IS THE CORE "QUEST" DRIVER:**
> - The "major expense" IS the Scout's personal goal (e.g., gaming PC)
> - Req 1(a): Scout chooses the item — this should be their own motivated choice
> - Req 1(b): A WRITTEN savings plan, discussed with counselor, family, and considering other family needs
> - Req 1(c): A WRITTEN shopping strategy with quality research AND price comparison from at least 2 sources
>
> **MCP implication:** This is where the Scout's personal goal directly drives the merit badge. The agent helps the Scout:
> 1. Define what they want to buy (and frame it as a family purchase)
> 2. Write a real savings plan
> 3. Research quality (consumer reviews, benchmarks for PC parts)
> 4. Comparison shop with at least 2 price sources
> 5. Consider alternatives (used parts? wait for sales? different build?)
>
> **Important clarification (from BSA forums):** Requirement 1 and Requirement 2 are INDEPENDENT. The budget in Req 2 is not specifically for saving toward the Req 1 purchase. Req 1 teaches acquisition planning; Req 2 teaches income/expense management.

### Requirement 2

Do the following:

- **(a)** Prepare a budget reflecting your expected income (allowance, gifts, wages), expenses, and savings for a period of 13 consecutive weeks.

- **(b)** Compare expected income with expected expenses.
  - **(1)** If expenses exceed budget income, determine steps to balance your budget.
  - **(2)** If income exceeds budget expenses, state how you would use the excess money (new goal, savings).

- **(c)** Track and record your actual income, expenses, and savings for 13 consecutive weeks (the same 13-week period for which you budgeted). (You may use the forms provided in the *Personal Management* merit badge pamphlet, devise your own, or use a computer-generated version). When complete, present the records showing the results to your counselor.

- **(d)** Compare your budget with your actual income and expenses to understand when your budget worked and when it did not work. With your counselor, discuss what you might do differently the next time.

> **KEY DETAIL:** This is the second longest-duration requirement: 13 consecutive weeks (~3 months).
> - The Scout must FIRST prepare a budget (projected), THEN track actuals for 13 weeks
> - Budget must include: income sources (allowance, gifts, wages), expenses, AND savings
> - The same 13-week period is used for both budget and tracking
> - At the end: compare projected vs actual and discuss what worked/didn't
>
> **MCP implication:** This requirement should be started at the same time as Family Life Req 3 (90 days ≈ 13 weeks). The agent needs to:
> 1. Help the Scout set up a budget template
> 2. Track weekly entries over 13 weeks
> 3. Generate comparison reports at the end
> 4. Prep the Scout for the counselor discussion

### Requirement 3

Discuss with your counselor FIVE of the following concepts:

- **(a)** The emotions you feel when you receive money.
- **(b)** Your understanding of how the amount of money you have with you affects your spending habits.
- **(c)** Your thoughts when you buy something new and your thoughts about the same item three months later. Explain the concept of buyer's remorse.
- **(d)** How hunger affects you when shopping for food items (snacks, groceries).
- **(e)** Your experience of an item you have purchased after seeing or hearing advertisements for it. Did the item work as well as advertised?
- **(f)** Your understanding of what happens when you put money into a savings account.
- **(g)** Charitable giving. Explain its purpose and your thoughts about it.
- **(h)** What you can do to better manage your money.

> **KEY DETAIL:** Scout must discuss FIVE of the eight options. This is a discussion requirement, not a written one.
>
> **MCP implication:** The agent can help the Scout think through these concepts and prepare talking points. Topics (b), (c), (e), and (h) naturally connect to the gaming PC purchase journey.

### Requirement 4

Explain the following to your counselor:

- **(a)** The differences between saving and investing, including reasons for using one over the other.
- **(b)** The concepts of return on investment and risk and how they are related.
- **(c)** The concepts of simple interest and compound interest.
- **(d)** The concept of diversification in investing.
- **(e)** Why it is important to save and invest for retirement.

> **KEY DETAIL:** ALL five sub-requirements must be explained. This is a knowledge requirement.

### Requirement 5

Explain to your counselor what the following investments are and how each works:

- **(a)** Common stocks
- **(b)** Mutual funds
- **(c)** Life insurance
- **(d)** A certificate of deposit (CD)
- **(e)** A savings account
- **(f)** A U.S. savings bond

> **KEY DETAIL:** ALL six sub-requirements. Knowledge requirement.

### Requirement 6

Explain to your counselor why people might purchase the following types of insurance and how they work:

- **(a)** Automobile
- **(b)** Health
- **(c)** Homeowner's/renter's
- **(d)** Whole life and term life

> **KEY DETAIL:** ALL four sub-requirements. Knowledge requirement.

### Requirement 7

Explain to your counselor the following:

- **(a)** What a loan is, what interest is, and how the annual percentage rate (APR) measures the true cost of a loan
- **(b)** The different ways to borrow money
- **(c)** The differences between a charge card, debit card, and credit card, including the costs and pitfalls of using these financial tools, and why it is unwise to make only the minimum payment on your credit card
- **(d)** Credit reports and how personal responsibility can affect your credit report
- **(e)** Ways to reduce or eliminate debt

> **KEY DETAIL:** ALL five sub-requirements. Knowledge requirement.

### Requirement 8

Demonstrate to your counselor your understanding of time management by doing the following:

- **(a)** Write a "to do" list of tasks or activities, such as homework assignments, chores, and personal projects, that must be done in the coming week. List these in order of importance to you.

- **(b)** Make a seven-day calendar or schedule. Put in your set activities, such as school classes, sports practices or games, jobs or chores, and/or Scout or place of worship or club meetings, then plan when you will do all the tasks from your "to do" list between your set activities.

- **(c)** Follow the one-week schedule you planned. Keep a daily diary or journal during each of the seven days of this week's activities, writing down when you completed each of the tasks on your "to do" list compared to when you scheduled them.

- **(d)** With your counselor, review your "to do" list, one-week schedule, and diary/journal to understand when your schedule worked and when it did not work. Discuss what you might do differently the next time.

> **KEY DETAIL:** This is a practical, one-week requirement:
> 1. Write prioritized to-do list
> 2. Create 7-day schedule integrating fixed activities + to-do items
> 3. Follow the schedule for one week while keeping a daily diary
> 4. Review with counselor
>
> **MCP implication:** The agent can help the Scout build the schedule and provide daily journaling prompts. The gaming PC research/chores/budgeting work can be incorporated into the schedule.

### Requirement 9

Prepare a written project plan demonstrating the steps below, including the desired outcome. This is a project on paper, not a real-life project. Examples could include planning a camping trip, developing a community service project or a school or religious event, or creating an annual patrol plan with additional activities not already included in the troop annual plan. Discuss your completed project plan with your counselor.

- **(a)** Define the project. What is your goal?
- **(b)** Develop a timeline for your project that shows the steps you must take from beginning to completion.
- **(c)** Describe your project.
- **(d)** Develop a list of resources. Identify how these resources will help you achieve your goal.
- **(e)** Develop a budget for your project.

> **KEY DETAIL:** This is a PAPER project plan — it does not need to be executed. However, it could be based on a real planned project.
>
> **MCP implication:** The gaming PC build itself could serve as the basis for this project plan. The Scout would define the goal, create a timeline, describe the build, list resources (parts, tools, guides), and develop a budget. This naturally reinforces the work from Req 1.

### Requirement 10

Do the following:

- **(a)** Choose a career you might want to enter after high school or college graduation. Discuss with your counselor the needed qualifications, education, skills, and experience.

- **(b)** Explain to your counselor what the associated costs might be to pursue this career, such as tuition, school or training supplies, and room and board. Explain how you could prepare for these costs and how you might make up for any shortfall.

> **KEY DETAIL:** Career exploration requirement. Must discuss both the career path AND the financial aspects of pursuing it.

---

## 4. Guide to Advancement — Key Policies for Merit Badges

### 4.1 The Four Steps in Advancement (GTA 4.2.1.0)

1. **The Scout Learns** (4.2.1.1) — Through participation in activities, reading, research, and practice
2. **The Scout Is Tested** (4.2.1.2) — Requirements are verified by authorized testers. Once signed off, the requirement is met and cannot be rescinded.
3. **The Scout Is Reviewed** (4.2.1.3) — Board of review (for rank advancement, not individual merit badges)
4. **The Scout Is Recognized** (4.2.1.4) — Awards are presented

### 4.2 Fulfilling More Than One Requirement With a Single Activity (GTA 4.2.3.6)

A single activity CAN satisfy requirements across different merit badges or ranks, as long as the Scout meets each requirement as stated. For example, tracking chores for Family Life Req 3 could overlap with the budgeting/income tracking for Personal Management Req 2 if the chores generate income.

### 4.3 The Merit Badge Process (GTA 7.0.0.2 — The Blue Card)

1. Scout discusses interest in a merit badge with unit leader
2. Unit leader signs the Application for Merit Badge ("blue card") or approves via Scoutbook
3. Scout contacts the merit badge counselor
4. Scout works on requirements with counselor guidance
5. Counselor signs off individual requirements as completed
6. When all requirements are met, counselor signs the blue card
7. Scout returns completed blue card to unit leader

### 4.4 The Counselor's Role (GTA 7.0.3.1)

> "The counselor helps the Scout learn and meet the requirements but shall not go so far as to essentially do the work for the Scout."

The counselor:
- Explains what is expected
- Helps the Scout understand requirements
- Coaches through difficulties
- Signs off when satisfied the Scout has personally completed each requirement
- May work with individual Scouts or groups
- Must ensure each Scout demonstrates individual competency

### 4.5 Partial Completions (GTA 7.0.3.3)

A counselor who cannot finish working with a Scout on a merit badge may sign off on completed requirements. The Scout can then continue with a different counselor who picks up where the first left off. Partial completions should be recorded.

### 4.6 What to Do When Requirements Change (GTA 7.0.4.3)

- Scouts who have already started a merit badge may continue using the old requirements
- Scouts beginning a new merit badge must use the current requirements as posted on the Merit Badge Hub
- There is no time limit for completing a merit badge, but all work must be done before the Scout turns 18

### 4.7 Once Earned, It's Earned (GTA 7.0.4.6)

Once a merit badge is earned, it is earned for life. It cannot be taken away.

### 4.8 Unofficial Worksheets and Learning Aids (GTA 7.0.4.8)

> "Worksheets and other materials that may be of assistance in earning merit badges are available from a variety of unofficial sources. Use of these aids is permissible as long as the materials can be correlated with the current requirements that Scouts must fulfill. Completing 'worksheets' may suffice where a requirement calls for something in writing, but this would not work for a requirement where the Scout must discuss, tell, show, or demonstrate, etc. Note that Scouts must not be required to use these learning aids in order to complete a merit badge."

**MCP implication:** The agent's tracking tools and templates are perfectly acceptable as learning aids, as long as the Scout is not required to use them and they align with current requirements.

### 4.9 Using Technology-Based Tools in Advancement (GTA 5.0.8.0)

The 2025 GTA includes new policy on group/online instruction and use of artificial intelligence. The agent should support the Scout's use of technology as a learning tool while ensuring the Scout does their own work.

---

## 5. Merit Badge Counseling Process

From "A Guide for Merit Badge Counseling" (BSA Publication 512-065, 2025):

### 5.1 The Counselor's Responsibility

1. Assist Scouts as they plan assigned projects and activities to meet all requirements
2. Coach them through interviews and demonstrations on how to complete requirements
3. Sign off with approval once satisfied the Scout has individually and personally completed the requirements exactly as written

### 5.2 The Step-by-Step Process

1. Scout contacts counselor (usually by text or email)
2. Counselor explains expectations
3. At first visit, counselor confirms Scout has unit leader approval (blue card or Scoutbook)
4. Counselor assesses what the Scout already knows
5. Counselor helps Scout learn remaining requirements and gives guidance on projects
6. Scout makes appointments when ready to demonstrate completion
7. Counselor verifies requirements through discussion, demonstration, or review of work products
8. When all requirements are met, counselor signs the blue card

### 5.3 Key Counseling Principles

- **Talking rather than grilling** — the review should feel like a conversation, not an exam
- **Express honest enthusiasm** — especially for projects
- **The Scout takes initiative** — the counselor is a resource, not a task-master
- **Real projects are best** — practical, personally meaningful work beats made-up scenarios
- **The buddy system helps** — Scouts working together on the same badge stay more accountable

### 5.4 Tips from Experienced Counselors

**For Personal Management (from Scouting Magazine):**
- Start the long-term requirements (budget tracking, Req 2) immediately
- Work on knowledge requirements (Reqs 4-7) during counselor sessions while long-term projects run
- Make it real — use actual family purchases, real budgets, genuine career interests
- The Scout should submit the projected budget BEFORE starting the 13-week tracking period
- If the Scout has no income sources, encourage parents to pay for chores during the tracking period

**For Family Life (from Scouting Magazine):**
- Remember that families look different — avoid assuming a "traditional" family structure
- Family involvement is required for nearly every requirement
- Requirement 7 (effective parenting) may be the most important — encourage forward-looking discussion
- The chore requirement (Req 3) should feel like real contribution, not busy work
- Family meetings (Req 6) can span multiple sessions — some topics are sensitive

---

## 6. Troop 2024 Process & Modifications

Our troop's process is modified from standard BSA procedures to accommodate the realities of busy scouts, parents, and leaders who find it hard to get face-to-face time. These modifications are approved and should be reflected in the agent's workflow.

### 6.1 Virtual Blue Card Process

BSA requires a signed Application for Merit Badge ("blue card") before a Scout begins work. Our troop's approved process:

1. **Scout emails the Scoutmaster (SM) or Assistant Scoutmaster (ASM)** requesting to start the merit badge and asking for a counselor assignment
2. SM/ASM assigns a counselor and **signs the start of the MB in Scoutbook Plus**
3. This virtual blue card process replaces the traditional paper blue card for initiating work
4. The agent should prompt the Scout to send this email as the very first step — no work should begin until the blue card is activated

> **Agent behavior:** When a Scout first starts the quest, the agent should help them compose an email to their SM/ASM requesting to start both Family Life and Personal Management merit badges. The agent helps the Scout draft this (the Scout writes it, agent reviews), but does NOT send it — the Scout sends it themselves.

### 6.2 Interaction Modes for Requirements

Our troop allows different interaction modes depending on the nature of the requirement. The per-scout config defines the allowed mode for each requirement, but the defaults are:

| Requirement Verb | Default Mode | Rationale |
|---|---|---|
| **"Discuss"** | In-person or video/audio | Discussion requirements imply back-and-forth conversation; the counselor needs to assess understanding |
| **"Explain"** | Email acceptable | The Scout can write out their explanation; counselor reviews and asks follow-up questions |
| **"Knowledge/factual"** | Email acceptable | Straightforward demonstration of understanding |
| **"Track/record/keep"** | Digital submission | Chore logs, budget spreadsheets, journals — submit electronically |
| **"Plan/prepare/write"** | Email for submission, may need in-person review | Written deliverables submitted digitally, but counselor may want to discuss in person |
| **"Carry out/do"** | Parent/counselor verification | Projects and activities verified by parent or counselor after completion |

Video/audio calls are acceptable alternatives to in-person for any requirement where in-person is the default. The config can override any default per-requirement.

### 6.3 Counselor Structure

Each merit badge has its own counselor — typically different people for Family Life and Personal Management. The config tracks counselor contact info per badge. The agent should help the Scout coordinate with the right counselor for each requirement and batch related requirements into the same counselor session when possible.

### 6.4 SM/ASM Role in Configuration

The SM or ASM seeds the per-scout configuration file before the Scout begins the quest. This includes:
- Which requirements are already completed (from prior work)
- Which requirements are in-scope for the quest
- Which requirements are explicitly excluded (e.g., Scout has a reason to defer)
- Counselor assignments
- Any per-requirement interaction mode overrides

The agent uses this config as its ground truth and does not modify the excluded/completed status without SM/ASM authorization.

---

## 7. Quest Design Philosophy

### 7.1 The Goal Drives the Requirements

The quest is built around something the Scout **personally chose** and is **excited to accomplish**. The agent's job is to connect that excitement to as many merit badge requirements as possible, so the Scout satisfies requirements as a natural byproduct of pursuing their goal.

The core principle: **requirements that CAN be fulfilled in service of the quest SHOULD be.** The agent assesses at design time which requirements map to the Scout's chosen goal and creates a unified path through both badges.

### 7.2 What Is Always Quest-Driven

Regardless of the specific goal, these requirements are ALWAYS central to the quest:

- **FL Req 3** — Chores for 90 days (the Scout earns money toward their goal through chores)
- **PM Req 1** — Major expense planning (the goal IS the major expense)
- **PM Req 2** — Budget tracking for 13 weeks (income from chores/work, expenses, savings toward goal)
- **PM Req 8** — Time management (scheduling chores, research, school, scouts)
- **PM Req 9** — Project plan (planning the goal itself)

These form the backbone of every quest regardless of what the Scout wants to buy or build.

### 7.3 Scouting Is a Journey, Not a Race

> The agent must balance productivity with the spirit of Scouting. The point is to help Scouts be productive and accomplish requirements while learning — and in doing so, accomplish THEIR goals. But advancement is not a competition.

Pacing guidance:
- **Start long-duration requirements immediately** (FL Req 3 + PM Req 2 on Day 1) to minimize total calendar time
- **Work through other requirements gradually** via daily engagement — a little each day keeps momentum without overwhelming
- **Never let the Scout lose track of effort** — losing track of weeks of work is deeply discouraging; the agent should provide regular progress summaries and celebrate milestones
- **Adapt timeframes** — if the Scout misses days, gets sick, has exams, the agent adjusts gracefully rather than declaring failure. Timelines are targets, not cliffs.

### 7.4 Quest Scope vs Full Badge Support

The initial prototype focuses on **driving the Scout through quest-related requirements**. However, for non-quest requirements (knowledge/discussion items like PM Reqs 4-7, FL Reqs 1, 2, 6, 7), the agent should:

1. Ask the Scout if they'd like to learn about the topic to prepare for a counselor discussion
2. If yes, teach the concept in an age-appropriate, engaging way connected to their quest when possible
3. Help them prepare talking points or written explanations
4. Track readiness but leave the actual sign-off to the counselor

The agent does NOT drive non-quest requirements proactively — it offers them when the Scout has bandwidth or asks.

---

## 8. Per-Scout Configuration Schema

The SM/ASM creates this config before the quest begins. The agent reads it as ground truth.

```yaml
# scout-quest-config.yaml
# Created by: SM/ASM
# Last modified: <date>

scout:
  name: "Will"
  age: 14
  troop: "2024"
  patrol: "Eagles"

quest:
  goal: "Build a gaming PC"
  goal_description: "Custom-built gaming PC for gaming and schoolwork"
  target_budget: 1200      # Scout's desired spend
  savings_capacity: 800    # Realistic savings over 13 weeks
  # If target_budget > savings_capacity, loan_path is activated
  loan_path_enabled: true  # Auto-calculated or manually set
  start_date: "2026-03-01"

counselors:
  personal_management:
    name: "Mr. McDaid"
    email: "mcdaid@example.com"
    preferred_contact: "email"
  family_life:
    name: "Mrs. Johnson"
    email: "johnson@example.com"
    preferred_contact: "email"

unit_leaders:
  scoutmaster:
    name: "Mr. Dunlop"
    email: "dunlop@example.com"
  asm:
    name: "Mr. Carter"
    email: "carter@example.com"

# Requirement status and configuration
# status: completed | in_scope | excluded
# interaction_mode: in_person | video | email | digital_submission | parent_verify
#   (defaults applied if not specified — see Section 6.2)

personal_management:
  req_1a:
    status: in_scope
    quest_driven: true
    interaction_mode: email      # submit item choice
  req_1b:
    status: in_scope
    quest_driven: true
    interaction_mode: email      # submit savings plan
    sub_1b1:                     # discuss plan with counselor
      interaction_mode: in_person
    sub_1b2:                     # discuss plan with family
      interaction_mode: parent_verify
    sub_1b3:                     # discuss other family needs
      interaction_mode: in_person
  req_1c:
    status: in_scope
    quest_driven: true
    interaction_mode: email      # submit shopping strategy
    sub_1c1:                     # quality research
      interaction_mode: email
    sub_1c2:                     # comparison shopping
      interaction_mode: email
  req_2a:
    status: in_scope
    quest_driven: true
    interaction_mode: digital_submission
  req_2b:
    status: in_scope
    quest_driven: true
    interaction_mode: email
  req_2c:
    status: in_scope
    quest_driven: true
    interaction_mode: digital_submission
    tracking_duration_weeks: 13
  req_2d:
    status: in_scope
    quest_driven: true
    interaction_mode: in_person   # discuss what worked/didn't
  req_3:
    status: in_scope
    quest_driven: false           # knowledge, not quest-driven
    topics_required: 5
    interaction_mode: in_person   # "discuss" requirement
  req_4:
    status: in_scope
    quest_driven: false
    interaction_mode: in_person   # "explain" but complex concepts
  req_5:
    status: in_scope
    quest_driven: false
    interaction_mode: email       # "explain" — factual knowledge
  req_6:
    status: in_scope
    quest_driven: false
    interaction_mode: email       # "explain" — factual knowledge
  req_7:
    status: in_scope
    quest_driven: true            # loan path activates this
    interaction_mode: email       # "explain" — factual knowledge
  req_8:
    status: in_scope
    quest_driven: true
    interaction_mode: in_person   # review schedule/diary with counselor
    tracking_duration_weeks: 1
  req_9:
    status: in_scope
    quest_driven: true
    interaction_mode: email       # submit project plan, discuss
  req_10:
    status: in_scope
    quest_driven: false
    interaction_mode: in_person   # "discuss" career exploration

family_life:
  req_1:
    status: in_scope
    quest_driven: false
    interaction_mode: in_person   # "discuss" — what is a family
  req_2:
    status: in_scope
    quest_driven: false
    interaction_mode: in_person   # "discuss" — importance to family
  req_3:
    status: in_scope
    quest_driven: true
    interaction_mode: digital_submission
    tracking_duration_days: 90
    min_chores: 5
  req_4:
    status: in_scope
    quest_driven: true            # individual home project
    needs_parent_approval: true
    needs_counselor_approval: true
    interaction_mode: parent_verify
  req_5:
    status: in_scope
    quest_driven: true            # family project
    interaction_mode: in_person   # "discuss" results with counselor
  req_6a:
    status: in_scope
    quest_driven: false
    interaction_mode: in_person   # "discuss" how to plan meetings
  req_6b:
    status: in_scope
    quest_driven: true            # topics 4 and 6 are quest-relevant
    interaction_mode: parent_verify  # meetings happen at home
    topics:
      - { id: 1, description: "Scout Oath/Law in family life", quest_relevant: false }
      - { id: 2, description: "Dangers and addictions facing youth", quest_relevant: false }
      - { id: 3, description: "Bodily changes and choices", quest_relevant: false }
      - { id: 4, description: "Personal and family finances", quest_relevant: true }
      - { id: 5, description: "Family crisis situations", quest_relevant: false }
      - { id: 6, description: "Effect of technology on family", quest_relevant: true }
      - { id: 7, description: "Good etiquette and manners", quest_relevant: false }
  req_7:
    status: in_scope
    quest_driven: false
    interaction_mode: in_person   # "discuss" — effective parenting
```

### 8.1 Config Rules

- **`status: completed`** — Requirement was finished in prior work. Agent skips it entirely.
- **`status: in_scope`** — Requirement is active for this quest. Agent tracks and supports it.
- **`status: excluded`** — SM/ASM has excluded this requirement for now (e.g., Scout will work on it separately). Agent ignores it.
- **`quest_driven: true`** — This requirement is directly connected to the Scout's goal. Agent proactively drives it.
- **`quest_driven: false`** — This requirement is NOT directly goal-connected. Agent offers to help if the Scout asks or has bandwidth, but does not push it.
- **`interaction_mode`** — Defines how the Scout completes/presents this requirement to the counselor. The agent tailors its coaching accordingly (e.g., "let's write up your explanation to email to your counselor" vs "let's prepare talking points for your meeting").
- Only the SM/ASM can change `status` or `excluded` flags. The agent can suggest changes but must not apply them unilaterally.

---

## 9. Quest Goal Archetypes & Requirement Mapping

### 9.1 How Goal Mapping Works

At quest design time, the agent assesses the Scout's goal against every requirement in both badges and classifies each as:

- **DIRECT** — The goal naturally satisfies this requirement (e.g., gaming PC IS the major expense for PM Req 1)
- **CONNECTABLE** — The goal can be connected with framing (e.g., family meeting about technology ties to gaming/tech)
- **INDEPENDENT** — The requirement has no natural connection to the goal (e.g., PM Req 6 on insurance types)

The quest path prioritizes DIRECT requirements, incorporates CONNECTABLE ones, and offers INDEPENDENT ones when the Scout is ready.

### 9.2 Archetype: Gaming PC / Tech Build

**Goal:** Build or buy a custom gaming PC (~$800-1500)  
**Why it works:** Major expense, research-heavy, tech-family overlap, natural chore-to-income pipeline

| Requirement | Mapping | How |
|---|---|---|
| PM 1a (major expense) | DIRECT | The PC IS the item |
| PM 1b (savings plan) | DIRECT | Earn through chores, save weekly |
| PM 1c (shopping strategy) | DIRECT | PCPartPicker, benchmarks, price comparison |
| PM 2 (13-week budget) | DIRECT | Track chore income → savings for PC |
| PM 3 (money emotions) | CONNECTABLE | Buyer's remorse on tech, ad influence on parts |
| PM 7 (loans/credit) | DIRECT (if loan path) | "Bank of Mom & Dad" loan analysis |
| PM 8 (time management) | CONNECTABLE | Schedule chores, research, school |
| PM 9 (project plan) | DIRECT | Plan the PC build: parts, timeline, budget |
| PM 10 (career) | CONNECTABLE | Computer science, IT, game development |
| FL 3 (chores 90 days) | DIRECT | Chores earn money toward the PC |
| FL 4 (individual project) | CONNECTABLE | PC build benefits family if shared/family-use framed |
| FL 5 (family project) | CONNECTABLE | Setting up family tech area, teaching family about PCs |
| FL 6b(4) (finances) | CONNECTABLE | Family meeting on budgeting ties to savings plan |
| FL 6b(6) (technology) | CONNECTABLE | Family meeting on tech use, screen time, gaming |

#### The Loan Path (Goal Exceeds Savings)

When `target_budget > savings_capacity`, the agent activates a loan analysis branch:

```
LOAN PATH TRIGGER: Scout wants $1200 PC but can save ~$800 in 13 weeks

The agent helps the Scout:
1. Calculate the gap ($400 shortfall)
2. Explore options:
   a. "Bank of Mom & Dad" loan — negotiate terms, interest, repayment schedule
   b. Save longer (extend timeline beyond 13 weeks)
   c. Compromise on specs (cheaper build that fits budget)
   d. Hybrid: save for base build, upgrade later
3. If pursuing loan option:
   - Calculate what monthly payments would look like
   - Understand APR concept using real numbers from their situation
   - Compare total cost with interest vs waiting to save
   - Draft a loan proposal to parents (real negotiation practice!)
4. This directly and meaningfully activates PM Req 7 (loans, APR, credit, debt)
   — the Scout learns about borrowing by actually doing the math on THEIR purchase

PM Req 7 sub-requirements activated by loan path:
  7a: What a loan is, interest, APR → Scout calculates APR on parent loan
  7b: Different ways to borrow → Compare parent loan vs saving vs credit
  7c: Charge/debit/credit cards → Discuss why NOT to put it on a credit card
  7d: Credit reports → How borrowing habits build (or damage) credit history
  7e: Ways to reduce debt → Paying off the parent loan, avoiding future debt
```

### 9.3 Archetype: Camping / Outdoor Gear

**Goal:** Buy quality camping setup (tent, pack, sleeping bag, ~$400-800)

| Requirement | Mapping | How |
|---|---|---|
| PM 1a | DIRECT | Camping gear is the item |
| PM 1c | DIRECT | REI vs Amazon vs used gear, quality ratings |
| PM 9 | CONNECTABLE | Plan a camping trip using the new gear |
| FL 4 | CONNECTABLE | Organize family gear storage, prep area at home |
| FL 5 | CONNECTABLE | Family camping trip using the gear |

### 9.4 Archetype: Musical Instrument

**Goal:** Buy a quality guitar, keyboard, or drum kit (~$300-1000)

| Requirement | Mapping | How |
|---|---|---|
| PM 1a | DIRECT | Instrument is the item |
| PM 1c | DIRECT | New vs used, brand research, music store vs online |
| PM 10 | CONNECTABLE | Music career, audio engineering, music education |
| FL 4 | CONNECTABLE | Set up practice space at home |
| FL 5 | CONNECTABLE | Family music night, teach family member |
| FL 6b(6) | CONNECTABLE | Technology in music (digital vs acoustic) |

### 9.5 Archetype: Vehicle / Transportation

**Goal:** Save toward first car, motorcycle, or e-bike (~$1000-5000)

| Requirement | Mapping | How |
|---|---|---|
| PM 1a | DIRECT | Vehicle is the item |
| PM 1c | DIRECT | Carfax, insurance quotes, used vs new |
| PM 6 | CONNECTABLE | Auto insurance becomes personally relevant |
| PM 7 | DIRECT (loan path) | Auto loans, financing terms |
| FL 6b(4) | CONNECTABLE | Family finances around transportation costs |

### 9.6 Generic Goal Mapping (Any Goal)

For goals not matching an archetype, the agent performs runtime mapping using this algorithm:

```
For each requirement in both badges:
  1. Does the goal directly satisfy this requirement? → DIRECT
  2. Can the goal be framed to connect? Test:
     - Does it involve money? → PM 1, 2, 3, 7 potential
     - Does it involve family? → FL 4, 5, 6 potential
     - Does it involve technology? → FL 6b(6) potential
     - Does it involve planning/building? → PM 9 potential
     - Does it involve a career field? → PM 10 potential
     - Does it happen at home? → FL 4 potential
  3. No connection? → INDEPENDENT (offer when Scout has bandwidth)
```

The agent presents the proposed mapping to the Scout at quest start and asks: "Does this feel right? What would you change?" The Scout's buy-in on the plan is essential.

---

## 10. Agent Behavior & Pacing

### 10.1 What the Agent Should and Should Not Do

**SHOULD:**
- Help the Scout understand requirements in plain language
- Ask questions that help the Scout think through answers
- Provide templates for budgets, chore trackers, schedules, project plans
- Send reminders for daily/weekly tracking
- Help the Scout prepare for counselor discussions (talking points for in-person, draft reviews for email)
- Connect the Scout's personal goal to specific requirements
- Celebrate progress and milestones — especially on long-duration tracking
- Explain financial concepts (Reqs 4-7) in age-appropriate terms using the Scout's own goal as examples
- Offer to help with non-quest requirements when the Scout has bandwidth
- Adapt gracefully when the Scout misses days, gets busy, or needs to adjust timelines
- Proactively surface progress summaries so the Scout never loses track of weeks of effort

**SHOULD NOT:**
- Write the Scout's budget, savings plan, or shopping strategy for them
- Send emails or messages on behalf of the Scout
- Sign off on requirements (only the counselor can do this)
- Add requirements beyond what BSA specifies
- Skip requirements or declare them "close enough"
- Replace the counselor relationship — the agent supplements, not substitutes
- Share or discuss personal family information outside the conversation
- Push non-quest requirements unless the Scout asks or has expressed interest
- Create urgency or pressure — Scouting is a journey, not a race
- Let the Scout forget about in-progress tracking (chores, budget) without check-ins

### 10.2 Daily Engagement Pattern

The agent's ideal daily touchpoint with the Scout:

```
DAILY CHECK-IN (2-5 minutes):
  1. "Did you do your chores today?" → Log FL Req 3
  2. "Any income or expenses to record?" → Log PM Req 2
  3. Quick progress note or encouragement
  4. If Scout has time: "Want to work on [next quest task]?"

WEEKLY SUMMARY (once per week):
  1. Chore completion rate this week
  2. Budget tracking: income vs expenses vs savings
  3. Progress toward goal amount
  4. Days remaining on 90-day and 13-week clocks
  5. Next milestone or counselor touchpoint coming up
  6. "Anything you want to work on this week?"

MILESTONE CELEBRATIONS:
  - 30 days of chores ✅ (1/3 of FL Req 3)
  - 60 days of chores ✅ (2/3)
  - 90 days — CHORES COMPLETE 🎉
  - 4 weeks of budget tracking
  - 8 weeks of budget tracking
  - 13 weeks — BUDGET COMPLETE 🎉
  - Each counselor sign-off
  - Savings milestones (25%, 50%, 75%, 100% of goal)
  - Quest complete — the Scout can buy/build their goal item!
```

### 10.3 Counselor Session Preparation

The agent helps the Scout batch requirements for efficient counselor sessions:

**Suggested session plan (Personal Management):**

| Session | Requirements | Mode | Content |
|---|---|---|---|
| 1 - Kickoff | Blue card, Req 1a | Email/in-person | Goal introduction, item selection |
| 2 - Plans | Req 1b, 1c | Email + in-person | Submit savings plan & shopping strategy, discuss |
| 3 - Budget start | Req 2a, 2b | Email | Submit projected budget for approval before tracking begins |
| 4 - Knowledge batch | Req 3 (5 topics), Req 4 | In-person | Discuss money emotions + savings/investing concepts |
| 5 - Knowledge batch | Req 5, 6 | Email | Submit written explanations of investments and insurance |
| 6 - Knowledge + loan | Req 7 | Email or in-person | Loans/credit — especially rich if loan path is active |
| 7 - Time mgmt | Req 8 | In-person | Review to-do list, schedule, and diary after 1-week exercise |
| 8 - Project + career | Req 9, 10 | Email + in-person | Submit project plan, discuss career exploration |
| 9 - Budget review | Req 2c, 2d | In-person | Present 13-week tracking records, discuss what worked |

**Suggested session plan (Family Life):**

| Session | Requirements | Mode | Content |
|---|---|---|---|
| 1 - Kickoff | Blue card, Req 1 | Email/in-person | Discuss what a family is |
| 2 - Self & chores | Req 2, Req 3 start | In-person | Why I'm important to my family; agree on chore list |
| 3 - Projects | Req 4 approval, Req 5 plan | Email/in-person | Get approval for individual project; plan family project |
| 4 - Family meetings | Req 6a, Req 6b prep | In-person | How to plan family meetings; review agenda |
| 5 - Project completion | Req 4 done, Req 5 done | Parent verify + in-person | Discuss project results |
| 6 - Meetings done | Req 6b completion | Parent verify | Confirm all 7 topics covered across meetings |
| 7 - Wrap-up | Req 3 done, Req 7 | In-person | Present 90-day chore log; discuss effective parenting |

### 10.4 Handling Timeline Disruptions

The agent must be prepared for reality:

- **Missed chore days:** Don't panic. Log the gap, note it, keep going. 90 days doesn't mean 90 consecutive perfect days — it means the Scout maintained regular duties over a 90-day period. A missed day here and there is real life.
- **Budget tracking gaps:** Help the Scout reconstruct from memory or receipts if they miss a week. Better to approximate than abandon.
- **School exams / holidays / illness:** Pause non-essential work, keep tracking requirements going with minimal friction. "Just log your chores and budget this week, we'll pick up the research next week."
- **Goal changes:** If the Scout's goal changes mid-quest (different item, different budget), adapt the mapping. The savings plan and budget tracking are still valid — only the target changes.
- **Counselor delays:** If a counselor takes weeks to respond, the agent keeps the Scout productive on other requirements and queues up a batch for when the counselor is available.

### 10.5 Requirement State Machine

Each requirement is tracked through these states:

```
not_started → in_progress → ready_for_review → submitted → signed_off
                  │                                 │
                  ├── tracking (time-based: 90d, 13wk)   ├── needs_revision (counselor feedback)
                  │                                 │
                  └── blocked (needs approval or prereq) └── back to in_progress
```

Additional states:
- **completed_prior** — Marked in config as done before quest started. Immutable.
- **excluded** — SM/ASM excluded. Agent ignores.
- **offered** — Agent has offered to help with a non-quest requirement; Scout hasn't started.
- **needs_approval** — FL Req 4 specifically: waiting on parent AND counselor approval before work begins.

---

## 11. MCP Server Data Model

See `docs/plans/2026-02-21-mcp-server-redesign.md` Section 4 for the authoritative
data model, including all collections, schemas, and the requirement state machine.

---

## Appendix A: Scout Oath and Scout Law

Referenced in Family Life Req 6b(1):

**Scout Oath:**
On my honor I will do my best to do my duty to God and my country and to obey the Scout Law; to help other people at all times; to keep myself physically strong, mentally awake, and morally straight.

**Scout Law:**
A Scout is trustworthy, loyal, helpful, friendly, courteous, kind, obedient, cheerful, thrifty, brave, clean, and reverent.

---

## Appendix B: Eagle-Required Merit Badge Context

Both Family Life and Personal Management are among the 14 Eagle-required merit badges. A total of 21 merit badges (14 required + 7 elective) must be earned for Eagle Scout rank. All merit badge work must be completed before the Scout turns 18.

The full list of Eagle-required merit badges:
1. First Aid
2. Citizenship in the Community
3. Citizenship in the Nation
4. Citizenship in Society
5. Citizenship in the World
6. Communication
7. Cooking
8. Personal Fitness
9. Emergency Preparedness OR Lifesaving
10. Environmental Science OR Sustainability
11. Camping OR Hiking OR Cycling OR Swimming
12. **Family Life** ✅
13. **Personal Management** ✅

---

*Document prepared for scout-quest MCP server design. All requirements sourced from official Scouting America publications. Troop 2024 process modifications documented with SM approval. This document should be updated whenever BSA publishes requirement changes or troop processes evolve.*
