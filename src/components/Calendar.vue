<script setup lang="ts">
  import * as feather from 'feather-icons';
  import { reactive, ref, onMounted, watch, type ShallowRef, computed, toRef, shallowRef, getCurrentInstance } from 'vue';
  import type { Ref } from 'vue';
  import { type PinCalendar, PinCatalog, type PinDay, type Pin, PinCalendarGetPinsOnDay, PinCalendarGetDay, PinDayTogglePin, PinCalendarPrepareDay, PinCalendarGetDayRef } from '../pins';
  import { Temporal } from '@js-temporal/polyfill';
  import PinIcon from './PinIcon.vue';
  import * as A from '@automerge/automerge-repo';
  import * as emojiSearch from 'node-emoji';
  import * as emojiGroups from 'unicode-emoji-json/data-by-group.json';
  import * as emojiComponents from 'unicode-emoji-json/data-emoji-components.json';
  import CalendarPinCategory from './CalendarPinCategory.vue';
  import type { CalendarPinCategoryEvent } from './CalendarPinCategory.vue';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import type { App } from '../account';

  type DayListDay = {
    date: Temporal.PlainDate,
    isInCurrentMonth: boolean,
    isCurrent: boolean,
  };

  const app = defineModel<App>();
  const docData = toRef(app.value!, 'docData');

  function getPinCalendar() {
    return toRef(docData.value!, 'pinCalendar');
  }

  function getPinCatalog() {
    return toRef(docData.value!, 'pinCatalog');
  }

//   const { pinCatalog, pinCalendar } = defineProps<{
//     pinCatalog: PinCatalog,
//     pinCalendar: PinCalendar,
//   }>();

  const dateNow = Temporal.Now.plainDateISO();
  const yearMonth = ref({
    date: dateNow,
  });
  const dayList: Ref<DayListDay[]> = ref(createDayList());
  const daySelected: Ref<DayListDay | null> = ref(null);
  const isDrawerOpen = ref(false);
  const pinDay: ShallowRef<Ref<Rop<PinDay>> | null> = shallowRef(null);

  function addMonths(months: number) {
    if (yearMonth.value) {
      yearMonth.value.date = yearMonth.value.date.add({ months });
    }
  }

  function clickDay(day: DayListDay) {
    daySelected.value = day;
    isDrawerOpen.value = true;
  }

  function isSelected(day: DayListDay) {
    if (daySelected.value !== null)
      return isSameDay(daySelected.value.date, day.date);
    else
      return false;
  }

  function clickPinToggle(pin: Pin) {
    if (pinDay.value !== null && pinDay.value.value !== null) {
      pinDay.value.value[changeSubtree]((pinDay: PinDay) => {
        PinDayTogglePin(pinDay, pin);
      })
    }
  }

  function isSameDay(a: Temporal.PlainDate, b: Temporal.PlainDate): boolean {
    return Temporal.PlainDate.compare(a, b) === 0;
  }

  function createDayList() : DayListDay[] {
    const firstDayOfMonth = Temporal.PlainDate.from({
        year: yearMonth.value.date.year,
        month: yearMonth.value.date.month,
        day: 1,
    });
    const firstDayOfFirstWeekOfMonth = firstDayOfMonth.subtract({ days: firstDayOfMonth.dayOfWeek - 1 });
    const daysInWeek = firstDayOfMonth.daysInWeek;
    const daysInMonth = firstDayOfMonth.daysInMonth;
    const numberOfWeeksDisplayed = Math.ceil((firstDayOfMonth.dayOfWeek - 1 + daysInMonth) / daysInWeek);
    const numberOfDaysDisplayed = numberOfWeeksDisplayed * 7;
    const newList: DayListDay[] = [];
    for (var i = 0; i < numberOfDaysDisplayed; i++) {
        const currentDate = firstDayOfFirstWeekOfMonth.add({ days: i });
        newList.push({
          date: currentDate,
          isInCurrentMonth: yearMonth.value.date.month === currentDate.month,
          isCurrent: isSameDay(currentDate, dateNow),
        });
    }
    return newList;
  }

  function onCalendarPinCategoryEvent(event: CalendarPinCategoryEvent) {
    switch (event.kind) {
      case 'toggle': {
        clickPinToggle(event.pin);
        break;
      }
    }
  }

  watch(yearMonth, () => {
    dayList.value = createDayList();
  }, { deep: true });

  watch(daySelected, () => {
    if (daySelected.value !== null) {
      if (PinCalendarPrepareDay(getPinCalendar().value, daySelected.value.date)) {
        pinDay.value = PinCalendarGetDayRef(getPinCalendar(), daySelected.value.date);
      } else {
        // pinDay already updated via the document change handler below, triggered by `PinCalendarPrepareDay`.
      }
    } else {
      pinDay.value = null;
    }

    console.log('daySelected changed. pinDay=', pinDay.value);
  });

  app.value!.docHandle.on('change', () => {
    if (daySelected.value !== null)
      pinDay.value = PinCalendarGetDayRef(getPinCalendar(), daySelected.value.date);

    // getCurrentInstance()?.proxy?.$forceUpdate();
  })
</script>

<template>
  <div class="drawer drawer-end">
    <input id="calendar-drawer" type="checkbox" class="drawer-toggle" v-model="isDrawerOpen" />
    <div class="drawer-content">
      <div class="flex justify-center">
        <div
          class="flex flex-col bg-base-100 items-center lg:w-[64rem] lg:my-8 max-lg:w-full dark:bg-slate-500">
          <div class="w-64 p-4 flex justify-center items-center">
            <button v-html="feather.icons['arrow-left'].toSvg()" @click="addMonths(-1)"
              class="btn btn-square btn-neutral" />
            <div class="flex-grow text-center text-xl inline">
              {{ yearMonth.date.toLocaleString(undefined, { month: "long" }) }}
            </div>
            <button v-html="feather.icons['arrow-right'].toSvg()" @click="addMonths(1)"
              class="btn btn-square btn-neutral" />
          </div>
          <div class="w-full">
            <div class="grid w-full bg-slate-300 gap-[1px] lg:px-[1px] py-[1px] lg:grid-cols-7 lg:shadow-xl">
              <div v-for="day of dayList.slice(0, 7)" class="p-1 text-lg text-center max-lg:hidden">
                {{ day.date.toLocaleString(undefined, { weekday: 'short' }) }}
              </div>
              <div v-for="day of dayList" @click="clickDay(day)"
                class="px-4 py-3 flex flex-col gap-2 bg-white box-border"
                :class="(day.isInCurrentMonth ? '' : 'max-lg:hidden lg:opacity-50') + ' ' + (day.isCurrent ? 'bg-blue-50' : '') + ' ' + (isSelected(day) ? 'outline outline-1 outline-blue-600 bg-blue-200' : '')">
                <div class="flex items-center gap-2 font-semibold text-lg">
                  <div class="flex w-8 h-8 rounded-full justify-center items-center"
                    :class="(day.isCurrent ? 'bg-blue-600 text-white' : 'bg-slate-200') + ' ' + (isSelected(day) ? 'outline outline-1 outline-blue-600' : '')">
                    <span class="inline-block">{{ day.date.day }}</span>
                  </div>
                  <div class="text-slate-500 lg:hidden" :class="isSelected(day) ? 'text-slate-600' : ''">{{
                    day.date.toLocaleString(undefined, { weekday: 'long' }) }}</div>
                </div>
                <div class="flex flex-wrap gap-1 justify-start">
                  <template v-for="pin of PinCalendarGetPinsOnDay(getPinCalendar().value, getPinCatalog().value, day.date)">
                    <PinIcon :pin="pin" />
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="drawer-side w-full z-10" v-if="pinDay !== null">
      <label for="calendar-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
      <div
        class="bg-base-200 text-base-content min-h-full w-80 p-4 shadow-[0_0_4rem_0px_rgba(0,0,0,0.3)] custom-drawer">
        <div class="text-2xl mb-4 text-center">{{ daySelected?.date.toLocaleString(undefined, { day: "numeric", month: "long" }) }}</div>
        <!-- <ul class="menu">
          <li><a>Sidebar Item 1</a></li>
          <li><a>Sidebar Item 2</a></li>
        </ul> -->
        <div class="collapse collapse-arrow bg-slate-300">
          <input type="checkbox" checked />
          <div class="collapse-title text-xl font-medium">Add/Remove Pins</div>
          <div class="collapse-content">
            <ul class="gap-1">
              <li v-for="rootCategory of getPinCatalog().value.rootCategories" class="flex flex-row items-center w-full gap-1">
                <CalendarPinCategory v-if="!rootCategory.archived" @event="onCalendarPinCategoryEvent" :depth=0
                  :pin-category="rootCategory" :pin-day="pinDay.value" />
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="css">
  .custom-drawer {
    width: calc(min(max(20rem, 50%), 80%));
  }
</style>
