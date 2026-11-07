export const scenarios = [
  {
    id: "games",
    icon: "dice-outline",
    name: "Community game night",
    label: "A seat at the table",
    description:
      "A fictional Calgary welcome night. A board-game table has an open chair and a refreshments table is nearby.",
    icebreaker: "Is this game open to another player?",
    alternative: "How does this game work?",
    entry: "Pause near the game table, then ask about the open chair.",
    revision: true,
  },
  {
    id: "garden",
    icon: "leaf-outline",
    name: "Neighbourhood garden",
    label: "Something in common",
    description:
      "A fictional community garden afternoon. A posted sign invites visitors to help plant herbs at a shared table.",
    icebreaker: "Is there a small planting task I could help with?",
    alternative: "Which herbs are you planting today?",
    entry: "Start with one of the planting tasks at the shared table.",
    revision: false,
  },
  {
    id: "welcome",
    icon: "cafe-outline",
    name: "Newcomer coffee meetup",
    label: "A simple hello",
    description:
      "A fictional newcomer coffee meetup. A welcome desk lists a short introduction activity. It is unclear whether the seated groups have started.",
    icebreaker: "Could you tell me how the introduction activity works?",
    alternative: "Is this where I check in for the meetup?",
    entry: "Ask at the welcome desk before joining a seated group.",
    revision: false,
  },
] as const;
export type ScenarioId = (typeof scenarios)[number]["id"];
