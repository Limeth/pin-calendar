import { Temporal } from "@js-temporal/polyfill";
import * as A from '@automerge/automerge'
import { changeSubtree, type Ro, type Rop } from "automerge-diy-vue-hooks";
import { toRef, type Ref } from "vue";
// import * as Y from 'yjs';

const LOCAL_STORAGE_KEY_PIN_CATALOG = "pin_catalog";
const LOCAL_STORAGE_KEY_PIN_CALENDAR = "pin_calendar";

type LocalStorageSerializable = {
    version: number;
};

type PinId = string;
type PinCategoryId = string;

type IconSvg = {
    svg: string,
};

type IconEmoji = {
    emoji: string,
    scale: number,
};

// type Icon = IconSvg | IconEmoji;
type Icon = IconEmoji;

export type Archiveable = {
    archived?: boolean,
}

export type PinCategoryInfo = {
    id: PinCategoryId,
    displayName: string,
    description: string,
};

export type PinCategory = PinCategoryInfo & Archiveable & {
    subcategories: PinCategory[],
    pins: Pin[],
};

export type Pin = Archiveable & {
    id: PinId,
    displayName: string,
    description: string,
    icon: Icon,
    backgroundColor: string,
};

export class PinCatalog implements LocalStorageSerializable {
    rootCategories: PinCategory[];
    version: number = 1;

    // Derived properties.
    pins: {
        [id: PinId]: {
            categoryId: PinCategoryId,
            pin: Pin,
        },
    };
    pinCategories: {
        [id: PinCategoryId]: {
            parentId?: PinCategoryId,
            pinCategory: PinCategory,
        },
    };

    constructor() {
        this.rootCategories = [];
        this.pins = {};
        this.pinCategories = {};
    }

    clear() {
        this.rootCategories.splice(0, this.rootCategories.length);
        this.pins = {};
        this.pinCategories = {};
    }

    addPin(categoryId: PinCategoryId, pin: Pin): Pin | undefined {
        if (categoryId in this.pinCategories) {
            const parentPins = this.pinCategories[categoryId].pinCategory.pins;
            const existingIndex = parentPins.findIndex((currentPin) => currentPin.id === pin.id);
            this.pins[pin.id] = {
                pin,
                categoryId,
            };
            if (existingIndex !== -1) {
                const previousValue = parentPins[existingIndex];
                parentPins[existingIndex] = pin;
                return previousValue;
            } else {
                parentPins.push(pin);
                return undefined;
            }
        }
        console.error("Failed to add a pin to a category.");
    }

    removePin(id: PinId): Pin | undefined {
        if (id in this.pins) {
            const previousValue = this.pins[id];

            // Delete from parent
            const parentPins = this.pinCategories[previousValue.categoryId].pinCategory.pins;
            const existingIndex = parentPins.findIndex((currentPin) => currentPin.id === id);
            parentPins.splice(existingIndex, 1);

            // Delete from map
            delete this.pins[id];

            return previousValue.pin;
        }
    }

    addPinCategory(parentCategoryId: PinCategoryId | undefined, pinCategory: PinCategory) : PinCategory | undefined {
        const previousValue = this.removePinCategory(pinCategory.id);

        function registerPinCategoryRecursive(pinCatalog: PinCatalog, parentCategoryId: PinCategoryId | undefined, pinCategory: PinCategory) {
            pinCatalog.pinCategories[pinCategory.id] = {
                pinCategory,
            };

            if (parentCategoryId !== undefined)
                pinCatalog.pinCategories[pinCategory.id].parentId = parentCategoryId;

            for (const subcategory of pinCategory.subcategories)
                registerPinCategoryRecursive(pinCatalog, pinCategory.id, subcategory);

            for (const pin of pinCategory.pins)
                pinCatalog.pins[pin.id] = {
                    categoryId: pinCategory.id,
                    pin,
                };
        }

        registerPinCategoryRecursive(this, parentCategoryId, pinCategory);

        if (parentCategoryId !== undefined) {
            if (parentCategoryId in this.pinCategories) {
                const parentSubcategories = this.pinCategories[parentCategoryId].pinCategory.subcategories;
                parentSubcategories.push(pinCategory);
            } else {
                console.error("Category not found.");
            }
        } else {
            this.rootCategories.push(pinCategory);
        }
        return previousValue;
    }

    removePinCategory(id: PinCategoryId): PinCategory | undefined {
        if (id in this.pinCategories) {
            const previousValue = this.pinCategories[id];

            // Recursively delete subcategories
            while (previousValue.pinCategory.subcategories.length > 0)
                this.removePinCategory(previousValue.pinCategory.subcategories[0].id);

            // Delete pins
            while (previousValue.pinCategory.pins.length > 0)
                this.removePin(previousValue.pinCategory.pins[0].id);

            // Delete from parent
            const parentPinCategories = previousValue.parentId !== undefined ? this.pinCategories[previousValue.parentId].pinCategory.subcategories : this.rootCategories;
            const existingIndex = parentPinCategories.findIndex((currentPinCategory) => currentPinCategory.id === id);
            parentPinCategories.splice(existingIndex, 1);

            /// Delete from map
            delete this.pinCategories[id];

            return previousValue.pinCategory;
        }
    }

    asJsonValue(): any {
        return {
            rootCategories: this.rootCategories,
            version: this.version,
        };
    }

    serialize(): string {
        return JSON.stringify(this.asJsonValue());
    }

    saveToLocalStorage() {
        localStorage.setItem(LOCAL_STORAGE_KEY_PIN_CATALOG, this.serialize());
    }

    static default(): PinCatalog {
        const pinCatalog = new PinCatalog();
        pinCatalog.addPinCategory(undefined, {
            id: 'health',
            displayName: 'Health',
            description: 'Mental and physical health.',
            subcategories: [{
                id: 'health-physical',
                displayName: 'Physical Health',
                description: 'Tasks focused on physical health.',
                subcategories: [],
                pins: [],
            }],
            pins: [],
        });
        pinCatalog.addPinCategory('health', {
            id: 'health-mental',
            displayName: 'Mental Health',
            description: 'Tasks focused on mental health.',
            subcategories: [],
            pins: [{
                id: "self-care",
                displayName: "Do some self-care",
                description: "Spend some personal time",
                icon: { emoji: '', scale: 1 },
                backgroundColor: "#00FF00",
                archived: false,
            }],
        });
        pinCatalog.addPinCategory(undefined, {
            id: 'hobbies',
            displayName: 'Hobbies',
            description: 'Tasks focused on hobbies.',
            subcategories: [],
            pins: [],
        });
        pinCatalog.addPin('health-physical', {
            id: "jog",
            displayName: "Go on a jog",
            description: "Run at least 5 km",
            icon: { emoji: '', scale: 1 },
            backgroundColor: "#FF0000",
            archived: false,
        });
        pinCatalog.addPin('hobbies', {
            id: "movie",
            displayName: "Watch a movie",
            description: "And enjoy it!",
            icon: { emoji: '', scale: 1 },
            backgroundColor: "#0000FF",
            archived: false,
        });
        return pinCatalog;
    }

    static fromJsonValue(json: any): PinCatalog | null {
        if (json.version > new PinCatalog().version) {
            console.error("Invalid catalog version: " + json.version);
            return null;
        }

        const catalog = new PinCatalog();

        for (const rootCategory of json.rootCategories) {
            catalog.addPinCategory(undefined, rootCategory);
        }

        return catalog;
    }

    static deserialize(serialized: string): PinCatalog | null {
        const json = JSON.parse(serialized);
        const catalog = this.fromJsonValue(json);

        return catalog;
    }

    static loadFromLocalStorage(): PinCatalog | null {
        const string = localStorage.getItem(LOCAL_STORAGE_KEY_PIN_CATALOG);

        if (string === null)
            return null;

        return this.deserialize(string);
    }

    static loadFromLocalStorageOrDefault(): PinCatalog {
        const loaded = this.loadFromLocalStorage();

        if (loaded !== null)
            return loaded;
        else
        {
            const catalog = this.default();
            catalog.saveToLocalStorage();
            return catalog;
        }
    }
};

export type PinnedPin = {
    count: number, // TODO: Allow more than 1
};

export type PinDayPins = {
    [pinId: PinId]: PinnedPin
};

export type PinDay = {
    pins: Array<PinId>;
}

export function PinDayHasPin(self: PinDay | Ro<PinDay>, pin: Pin): boolean {
    return self.pins.includes(pin.id);
}

export function PinDaySetPinPresence(self: PinDay, pin: Pin, presence: boolean) {
    if (presence)
    {
        if (!PinDayHasPin(self, pin))
            self.pins.push(pin.id);
    }
    else
    {
        const index = self.pins.findIndex((pinId) => pinId === pin.id);

        if (index !== -1)
            self.pins.splice(index, 1)
    }
}

export function PinDayTogglePin(self: PinDay, pin: Pin): boolean {
    const newValue = !PinDayHasPin(self, pin);
    PinDaySetPinPresence(self, pin, newValue);
    return newValue;
}

export function PinDayIsEmpty(self: PinDay): boolean {
    return self.pins.length === 0;
}

// function PinDayAsJsonValue(self: Y.Map<PinDay>): any {
//     return {
//         pins: Array.from(self.get('pins')!),
//     };
// }

// static fromJsonValue(json: any): PinDay {
//     const value = new PinDay();
//     for (const pinId of json.pins) {
//         value.pins.add(pinId);
//     }
//     return value;
// }

export type PinCalendarDays = {
    [key: string]: PinDay,
};

export type PinCalendar = LocalStorageSerializable & {
    days: PinCalendarDays;
    version: number;
}

export function PinCalendarNew(): PinCalendar {
    return {
        version: 1,
        days: {},
    };
}

export function PinCalendarClear(self: PinCalendar) {
    self.days = {};
}

function PinCalendarGetDayRefByKey(self: Ref<Rop<PinCalendar>>, key: string): Ref<Rop<PinDay>> | null {
    if (key in self.value.days)
        return toRef(self.value.days, key);
    else
        return null;
}

function PinCalendarGetDayByKey(self: Rop<PinCalendar>, key: string): Rop<PinDay> | null {
    if (key in self.days)
        return self.days[key];
    else
        return null;
}

function PinCalendarPrepareDayByKey(self: Rop<PinCalendar>, key: string): boolean {
    if (!(key in self.days))
    {
        self[changeSubtree]((pinCalendar: PinCalendar) => {
            pinCalendar.days[key] = {
                pins: [],
            };
        })
        return false;
    }
    else
        return true;
}

export function PinCalendarGetDayRef(self: Ref<Rop<PinCalendar>>, day: Temporal.PlainDate): Ref<Rop<PinDay>> | null {
    return PinCalendarGetDayRefByKey(self, PinCalendarDayToKey(day));
}

export function PinCalendarGetDay(self: Rop<PinCalendar>, day: Temporal.PlainDate): Rop<PinDay> | null {
    return PinCalendarGetDayByKey(self, PinCalendarDayToKey(day));
}

/// Returns `true` if the day was already prepared. Otherwise, the document must be updated.
export function PinCalendarPrepareDay(self: Rop<PinCalendar>, day: Temporal.PlainDate): boolean {
    return PinCalendarPrepareDayByKey(self, PinCalendarDayToKey(day));
}

export function PinCalendarGetPinsOnDay(self: Rop<PinCalendar>, catalog: Rop<PinCatalog>, day: Temporal.PlainDate): Set<Pin> {
    const result: Set<Pin> = new Set();
    const pinDay = PinCalendarGetDay(self, day);

    if (pinDay !== null) {
        for (const pinId of pinDay.pins) {
            const pin = catalog.pins[pinId];

            if (pin !== undefined) {
                result.add(pin.pin);
            }
        }
    }

    return result;
}

// function PinCalendarAsJsonValue(self: Y.Map<PinCalendar>, ): any {
//     const calendarToSave: { days: { [key: string]: any } } = { days: {} };
    
//     for (const [key, day] of Object.entries(this.days))
//         if (!PinDay.isEmpty(day))
//             calendarToSave.days[key] = PinDay.asJsonValue(day);
    
//     return calendarToSave;
// }

// function PinCalendarSerialize(self: Y.Map<PinCalendar>, ): string {
//     return JSON.stringify(this.asJsonValue());
// }

// function PinCalendarSaveToLocalStorage(self: Y.Map<PinCalendar>, ) {
//     localStorage.setItem(LOCAL_STORAGE_KEY_PIN_CALENDAR, this.serialize());
// }

// function PinCalendarStatic fromJsonValue(self: Y.Map<PinCalendar>, json: any): PinCalendar | null {
//     if (json.version > new PinCalendar().version) {
//         console.error("Invalid calendar version: " + json.version);
//         return null;
//     }

//     const calendar = new PinCalendar();

//     for (const [key, value] of Object.entries(json.days))
//         calendar.days[key] = PinDay.fromJsonValue(value);

//     return calendar;
// }

function PinCalendarDayToKey(day: Temporal.PlainDate): string {
    return day.toString();
}

export function PinCalendarKeyToDay(key: string): Temporal.PlainDate {
    return Temporal.PlainDate.from(key);
}

// function PinCalendarDeserialize(self: Y.Map<PinCalendar>, serialized: string): PinCalendar | null {
//     const json = JSON.parse(serialized);
//     const calendar = PinCalendar.fromJsonValue(json);

//     return calendar;
// }

// function PinCalendarLoadFromLocalStorage(self: Y.Map<PinCalendar>): PinCalendar | null {
//     const string = localStorage.getItem(LOCAL_STORAGE_KEY_PIN_CALENDAR);

//     if (string === null)
//         return null;

//     return this.deserialize(string);
// }

// function PinCalendarLoadFromLocalStorageOrDefault(self: Y.Map<PinCalendar>): PinCalendar {
//     const loaded = this.loadFromLocalStorage();

//     if (loaded !== null)
//         return loaded;
//     else
//     {
//         const calendar = new PinCalendar();
//         calendar.saveToLocalStorage();
//         return calendar;
//     }
// }
