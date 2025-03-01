/* eslint-disable unicorn/no-null */
/* eslint-disable react/display-name */
import { scaleLinear } from 'd3-scale';
import { stack, stackOffsetDiverging } from 'd3-shape';
import TimeAxis from 'features/time/TimeAxis'; // TODO: Move to a shared folder
import { useAtom } from 'jotai';
import React, { useMemo, useState } from 'react';
import { ZoneDetail } from 'types';
import { TimeAverages } from 'utils/constants';
import { selectedDatetimeIndexAtom } from 'utils/state/atoms';
import { useBreakpoint } from 'utils/styling';
import { useReferenceWidthHeightObserver } from 'utils/viewport';
import { getTimeScale, isEmpty } from '../graphUtils';
import AreaGraphTooltip from '../tooltips/AreaGraphTooltip';
import { AreaGraphElement, FillFunction, InnerAreaGraphTooltipProps } from '../types';
import AreaGraphLayers from './AreaGraphLayers';
import GraphBackground from './GraphBackground';
import GraphHoverLine from './GraphHoverline';
import ValueAxis from './ValueAxis';

const X_AXIS_HEIGHT = 20;
const Y_AXIS_WIDTH = 40;
const Y_AXIS_PADDING = 4;

const getTotalValues = (layers: any) => {
  // Use a single loop to find the min and max values of the datapoints
  let min = 0;
  let max = 0;
  for (const layer of layers) {
    for (const [low, high] of layer.datapoints) {
      // Check if the values are finite numbers
      if (Number.isFinite(low)) {
        min = Math.min(min, low);
      }
      if (Number.isFinite(high)) {
        max = Math.max(max, high);
      }
    }
  }
  // Return the min and max values
  return {
    min: min,
    max: max,
  };
};

const getValueScale = (height: number, totalValues: { min: number; max: number }) =>
  scaleLinear()
    .domain([Math.min(0, 1.1 * totalValues.min), Math.max(0, 1.1 * totalValues.max)])
    .range([height, Y_AXIS_PADDING]);

const getLayers = (
  data: AreaGraphElement[],
  layerKeys: string[],
  layerFill: FillFunction,
  markerFill?: FillFunction,
  layerStroke?: (key: string) => string
) => {
  if (!data || !data[0]) {
    return [];
  }

  const stackedData = stack<AreaGraphElement>()
    .offset(stackOffsetDiverging)
    .value((d: AreaGraphElement, key: string) =>
      Number.isNaN(d.layerData[key]) ? 0 : d.layerData[key]
    ) // Assign 0 if no data
    .keys(layerKeys)(data);

  return layerKeys.map((key: string, index: number) => ({
    key,
    stroke: layerStroke ? layerStroke(key) : 'none',
    fill: layerFill(key),
    markerFill: markerFill ? markerFill(key) : layerFill(key),
    datapoints: stackedData[index],
  }));
};

interface AreagraphProps {
  data: AreaGraphElement[];
  testId: string;
  layerKeys: string[];
  layerStroke?: (key: string) => string;
  layerFill: FillFunction;
  markerFill?: FillFunction;
  valueAxisLabel: string;
  markerUpdateHandler: any;
  markerHideHandler: any;
  isMobile: boolean;
  isOverlayEnabled?: boolean;
  height: string;
  datetimes: Date[];
  selectedTimeAggregate: TimeAverages; // TODO: Graph does not need to know about this
  tooltip: (props: InnerAreaGraphTooltipProps) => JSX.Element | null;
  tooltipSize?: 'small' | 'large';
  formatTick?: (t: number) => string | number;
}

interface TooltipData {
  position: { x: number; y: number };
  zoneDetail: ZoneDetail;
}

function AreaGraph({
  data,
  testId,
  layerKeys,
  layerStroke,
  layerFill,
  markerFill,
  valueAxisLabel,
  isMobile,
  height = '10em',
  isOverlayEnabled = false,
  selectedTimeAggregate,
  datetimes,
  tooltip,
  tooltipSize,
  formatTick = String,
}: AreagraphProps) {
  const {
    ref,
    width: containerWidth,
    height: containerHeight,
    node,
  } = useReferenceWidthHeightObserver(Y_AXIS_WIDTH, X_AXIS_HEIGHT);

  const [selectedDate] = useAtom(selectedDatetimeIndexAtom);
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const isBiggerThanMobile = useBreakpoint('sm');

  // Build layers
  const layers = useMemo(
    () => getLayers(data, layerKeys, layerFill, markerFill, layerStroke),
    [data, layerKeys, layerStroke, layerFill, markerFill]
  );

  // Generate graph scales
  const totalValues = useMemo(() => getTotalValues(layers), [layers]);
  const valueScale = useMemo(
    () => getValueScale(containerHeight, totalValues),
    [containerHeight, totalValues]
  );
  const startTime = datetimes?.at(0);
  const lastTime = datetimes?.at(-1);
  const interval = datetimes?.at(-2);

  if (!startTime || !lastTime || !interval) {
    return null;
  }
  const intervalMs =
    datetimes.length > 1 && interval && lastTime
      ? lastTime.getTime() - interval.getTime()
      : 0;
  // The endTime needs to include the last interval so it can be shown
  const endTime = useMemo(
    () => new Date(lastTime.getTime() + intervalMs),
    [lastTime, intervalMs]
  );
  const datetimesWithNext = useMemo(() => [...datetimes, endTime], [datetimes, endTime]);
  if (!endTime) {
    return null;
  }
  const timeScale = useMemo(
    () => getTimeScale(containerWidth, startTime, endTime),
    [containerWidth, startTime, endTime]
  );

  const [graphIndex, setGraphIndex] = useState(null);
  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number | null>(null);

  const hoverLineTimeIndex = graphIndex ?? selectedDate.index;

  // Graph update handlers. Used for tooltip data.
  const markerUpdateHandler = useMemo(
    () => (position: { x: number; y: number }, dataPoint: AreaGraphElement) => {
      setTooltipData({
        position,
        zoneDetail: dataPoint.meta,
      });
    },
    [setTooltipData]
  );
  const markerHideHandler = useMemo(
    () => () => {
      setTooltipData(null);
    },
    [setTooltipData]
  );

  // Mouse action handlers
  const mouseMoveHandler = useMemo(
    () => (timeIndex: any, layerIndex: any) => {
      setGraphIndex(timeIndex);
      if (layers.length <= 1) {
        // Select the first (and only) layer even when hovering over background
        setSelectedLayerIndex(0);
      } else {
        // use the selected layer (or undefined to hide the tooltips)
        setSelectedLayerIndex(layerIndex);
      }
    },
    [layers, setGraphIndex, setSelectedLayerIndex]
  );
  const mouseOutHandler = useMemo(
    () => () => {
      setGraphIndex(null);
      setSelectedLayerIndex(null);
    },
    [setGraphIndex, setSelectedLayerIndex]
  );

  // Don't render the graph at all if no layers are present
  if (isEmpty(layers)) {
    console.error('No layers present in AreaGraph');
    return null;
  }

  // Don't render the graph if datetimes and datapoints are not in sync
  for (const layer of layers) {
    if (layer.datapoints.length !== datetimes.length) {
      console.error('Datetimes and datapoints are not in sync');
      return null;
    }
  }

  if (layers.every((layer) => layer.datapoints.every((d) => d[0] === 0 && d[1] === 0))) {
    // Don't render the graph if all datapoints are 0
    return null;
  }

  return (
    <svg
      data-test-id={testId}
      height={height}
      ref={ref}
      className="w-full overflow-visible"
    >
      <GraphBackground
        timeScale={timeScale}
        valueScale={valueScale}
        datetimes={datetimes}
        mouseMoveHandler={mouseMoveHandler}
        mouseOutHandler={mouseOutHandler}
        isMobile={isMobile}
        svgNode={node}
      />
      <AreaGraphLayers
        layers={layers}
        datetimes={datetimesWithNext}
        timeScale={timeScale}
        valueScale={valueScale}
        mouseMoveHandler={mouseMoveHandler}
        mouseOutHandler={mouseOutHandler}
        isMobile={isMobile}
        svgNode={node}
      />
      {!isOverlayEnabled && (
        <TimeAxis
          isLoading={false}
          selectedTimeAggregate={selectedTimeAggregate}
          datetimes={datetimesWithNext}
          scaleWidth={containerWidth}
          transform={`translate(5 ${containerHeight})`}
          className="h-[22px] w-full overflow-visible opacity-50"
        />
      )}
      <ValueAxis
        scale={valueScale}
        label={valueAxisLabel}
        width={containerWidth}
        height={containerHeight}
        formatTick={formatTick}
      />
      <GraphHoverLine
        layers={layers}
        timeScale={timeScale}
        valueScale={valueScale}
        datetimes={datetimes}
        endTime={endTime}
        markerUpdateHandler={markerUpdateHandler}
        markerHideHandler={markerHideHandler}
        selectedLayerIndex={selectedLayerIndex}
        selectedTimeIndex={hoverLineTimeIndex}
        svgNode={node}
      />
      {tooltip && (
        <AreaGraphTooltip
          {...tooltipData}
          selectedLayerKey={
            selectedLayerIndex === null ? undefined : layerKeys[selectedLayerIndex]
          }
          tooltipSize={tooltipSize}
          isBiggerThanMobile={isBiggerThanMobile}
        >
          {(props) => tooltip(props)}
        </AreaGraphTooltip>
      )}
    </svg>
  );
}

export default React.memo(AreaGraph);
