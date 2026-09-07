import "src/lib/Instances/Dungeon.js";

const GameConstants = {
    DungeonTileType: {
        empty: 0,
        enemy: 1,
        chest: 2,
        boss: 3,
        ladder: 4,
        entrance: 5
    }
};

let DungeonRunner;

function makeTile(type, { visible = true, visited = false, tier = "common" } = {})
{
    return {
        isVisible: visible,
        isVisited: visited,
        metadata: { tier },
        type: () => type
    };
}

function makeBoard(size, fillType = GameConstants.DungeonTileType.empty)
{
    return Array.from({ length: size }, () => Array.from({ length: size }, () => makeTile(fillType, { visible: false })));
}

function setupMap(boards, playerPosition, accessiblePositions)
{
    const positionKeys = new Set(accessiblePositions.map(({ x, y, floor }) => `${x},${y},${floor}`));
    const map = {
        flash: {},
        board: () => boards,
        playerPosition: () => playerPosition,
        hasAccessToTile: ({ x, y, floor }) => positionKeys.has(`${x},${y},${floor}`),
        moveToCoordinates: jest.fn()
    };
    map.nearbyTiles = ({ x, y, floor }) => [
        boards[floor][y - 1]?.[x],
        boards[floor][y + 1]?.[x],
        boards[floor][y]?.[x - 1],
        boards[floor][y]?.[x + 1]
    ].filter(Boolean);

    DungeonRunner = { map };
    return map;
}

beforeEach(() =>
{
    AutomationDungeon.AutomationRequestedModes = [];
    AutomationDungeon.__internal__chestMinRarityDropdownList = {
        selectedValue: AutomationDungeon.__internal__chestTypes.epic
    };
    AutomationDungeon.__internal__floorEndPosition = null;
    AutomationDungeon.__internal__chestPositions = [];
});

describe("AutomationDungeon expanded Flash handling", () =>
{
    test("marks only visible and accessible objectives on the current floor", () =>
    {
        const firstFloor = makeBoard(3);
        const secondFloor = makeBoard(3);
        firstFloor[0][0] = makeTile(GameConstants.DungeonTileType.boss);
        secondFloor[0][0] = makeTile(GameConstants.DungeonTileType.boss);
        secondFloor[0][1] = makeTile(GameConstants.DungeonTileType.chest, { tier: "epic" });
        secondFloor[1][0] = makeTile(GameConstants.DungeonTileType.chest, { tier: "legendary" });
        secondFloor[1][1] = makeTile(GameConstants.DungeonTileType.ladder, { visible: false });

        setupMap([ firstFloor, secondFloor ], { x: 2, y: 2, floor: 1 }, [
            { x: 0, y: 0, floor: 1 },
            { x: 0, y: 1, floor: 1 },
            { x: 1, y: 1, floor: 1 }
        ]);

        AutomationDungeon.__internal__markVisibleAccessibleTiles();
        AutomationDungeon.__internal__markVisibleAccessibleTiles();

        expect(AutomationDungeon.__internal__floorEndPosition).toMatchObject({ x: 0, y: 0, floor: 1 });
        expect(AutomationDungeon.__internal__chestPositions).toHaveLength(1);
        expect(AutomationDungeon.__internal__chestPositions[0]).toMatchObject({ x: 0, y: 1, floor: 1 });
    });

    test("uses the same chest criteria for queueing, counting, and pathing", () =>
    {
        const board = makeBoard(2);
        const commonChest = { tile: makeTile(GameConstants.DungeonTileType.chest, { tier: "common" }), x: 0, y: 0, floor: 0 };
        const epicChest = { tile: makeTile(GameConstants.DungeonTileType.chest, { tier: "epic" }), x: 1, y: 0, floor: 0 };
        board[0][0] = commonChest.tile;
        board[0][1] = epicChest.tile;
        setupMap([ board ], { x: 0, y: 1, floor: 0 }, []);

        expect(AutomationDungeon.__internal__shouldCollectChest(commonChest)).toBe(false);
        expect(AutomationDungeon.__internal__shouldCollectChest(epicChest)).toBe(true);
        expect(AutomationDungeon.__internal__isRelevantObjective(commonChest)).toBe(false);
        expect(AutomationDungeon.__internal__isRelevantObjective(epicChest)).toBe(true);
        expect(AutomationDungeon.__internal__getChestLeftToOpenCount()).toBe(1);

        AutomationDungeon.AutomationRequestedModes = [ AutomationDungeon.InternalModes.ForceChestOpening ];
        expect(AutomationDungeon.__internal__shouldCollectChest(commonChest)).toBe(true);
        expect(AutomationDungeon.__internal__getChestLeftToOpenCount()).toBe(2);
    });

    test("does not let a skipped boss influence Flash pathing", () =>
    {
        const boss = { tile: makeTile(GameConstants.DungeonTileType.boss), x: 1, y: 1, floor: 0 };
        const ladder = { tile: makeTile(GameConstants.DungeonTileType.ladder), x: 1, y: 1, floor: 0 };

        expect(AutomationDungeon.__internal__isRelevantObjective(boss, false)).toBe(true);
        expect(AutomationDungeon.__internal__isRelevantObjective(boss, true)).toBe(false);
        expect(AutomationDungeon.__internal__isRelevantObjective(ladder, true)).toBe(true);
    });

    test("matches approach cells by cardinal position and floor", () =>
    {
        const firstFloor = makeBoard(3);
        const secondFloor = makeBoard(3);
        setupMap([ firstFloor, secondFloor ], { x: 0, y: 0, floor: 0 }, []);
        const candidate = { tile: firstFloor[0][1], x: 1, y: 0, floor: 0 };
        const sameFloorObjective = { tile: firstFloor[1][1], x: 1, y: 1, floor: 0 };
        const otherFloorObjective = { tile: secondFloor[1][1], x: 1, y: 1, floor: 1 };

        expect(AutomationDungeon.__internal__getObjectiveApproachCells([ candidate ], [ sameFloorObjective ])).toEqual([ candidate ]);
        expect(AutomationDungeon.__internal__getObjectiveApproachCells([ candidate ], [ otherFloorObjective ])).toEqual([]);
    });

    test("prefers a non-enemy move that makes a diagonal boss accessible", () =>
    {
        const board = makeBoard(3);
        board[0][0] = makeTile(GameConstants.DungeonTileType.entrance, { visited: true });
        board[0][1] = makeTile(GameConstants.DungeonTileType.empty);
        board[1][0] = makeTile(GameConstants.DungeonTileType.enemy);
        board[1][1] = makeTile(GameConstants.DungeonTileType.boss);
        const map = setupMap([ board ], { x: 0, y: 0, floor: 0 }, [
            { x: 1, y: 0, floor: 0 },
            { x: 0, y: 1, floor: 0 }
        ]);

        AutomationDungeon.__internal__handleFlashPathing();

        expect(map.moveToCoordinates).toHaveBeenCalledWith(1, 0, 0);
    });

    test("approaches a distance-two ladder and resets floor-local state for the transition", () =>
    {
        const board = makeBoard(3);
        board[2][1] = makeTile(GameConstants.DungeonTileType.entrance, { visited: true });
        board[1][1] = makeTile(GameConstants.DungeonTileType.empty);
        board[0][1] = makeTile(GameConstants.DungeonTileType.ladder);
        const map = setupMap([ board ], { x: 1, y: 2, floor: 0 }, [ { x: 1, y: 1, floor: 0 } ]);

        AutomationDungeon.__internal__handleFlashPathing();
        expect(map.moveToCoordinates).toHaveBeenCalledWith(1, 1, 0);

        AutomationDungeon.__internal__floorEndPosition = { x: 1, y: 0, floor: 0 };
        AutomationDungeon.__internal__chestPositions = [ { x: 0, y: 0, floor: 0 } ];
        AutomationDungeon.__internal__resetSavedStates();
        expect(AutomationDungeon.__internal__floorEndPosition).toBeNull();
        expect(AutomationDungeon.__internal__chestPositions).toEqual([]);
    });
});
