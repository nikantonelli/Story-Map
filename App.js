(function () {
    var Ext = window.Ext4 || window.Ext;

Ext.define('Rally.apps.StoryMap.app', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    config: {
        defaultSettings: {
            includeStories: false
        }
    },
    autoScroll: true,
    itemId: 'rallyApp',
    NODE_CIRCLE_SIZE: 8,
    MIN_CARD_WIDTH: 150,        //Looks silly on less than this
    CARD_BORDER_WIDTH: 5,
    MIN_ROW_WIDTH: 160,
    MIN_CARD_HEIGHT:    150,
    MIN_ROW_HEIGHT: 160 ,         //Bit more than the card to leave a gap
    LOAD_STORE_MAX_RECORDS: 100, //Can blow up the Rally.data.wsapi.filter.Or
    WARN_STORE_MAX_RECORDS: 300, //Can be slow if you fetch too many
    LEFT_MARGIN_SIZE: 0,               //Leave space for "World view" text
    MIN_COLUMN_WIDTH: 200,
    TITLE_NAME_LENGTH: 80,
    STORE_FETCH_FIELD_LIST:
    [
        'Name',
        'FormattedID',
        'Parent',
        'DragAndDropRank',
        'Children',
        'ObjectID',
        'Project',
        'DisplayColor',
        'Owner',
        'Blocked',
        'BlockedReason',
        'Ready',
        'Tags',
        'Workspace',
        'RevisionHistory',
        'CreationDate',
        'PercentDoneByStoryCount',
        'PercentDoneByStoryPlanEstimate',
        'State',
        'ScheduleState',
        'PreliminaryEstimate',
        'Description',
        'Notes',
        'Predecessors',
        'Successors',
        'UserStories',
        'Tasks',
        'WorkProduct',
        'OrderIndex',   //Used to get the State field order index
        //Customer specific after here. Delete as appropriate
        'c_ProjectIDOBN',
        'c_QRWP',
        'c_RAGStatus',
        'c_ProgressUpdate'
    ],
    CARD_DISPLAY_FIELD_LIST:
    [
        'Name', //This one
//        'Owner',
        'PreliminaryEstimate',
        // 'Parent',
        // 'Project',
        'PercentDoneByStoryCount',
        'PercentDoneByStoryPlanEstimate',
        // 'State',
        // 'c_ProjectIDOBN',
        // 'c_QRWP',
        // 'c_RAGStatus'

    ],
    items: [
        {
            xtype: 'container',
            itemId: 'rootSurface',
            margin: '5 5 5 5',
            layout: 'auto',
            autoEl: {
                tag: 'svg'
            },
            listeners: {
                afterrender:  function() {  gApp = this.up('#rallyApp'); gApp._onElementValid(this);},
            }
        }
    ],

    getSettingsFields: function() {
        var returned = [
            {
                name: 'includeStories',
                xtype: 'rallycheckboxfield',
                fieldLabel: 'Include User Stories',
                labelALign: 'middle'
            }
        ];
        return returned;
    },

    timer: null,

    launch: function() {
        this.on('redrawTree', this._resetTimer);
        // this.on('drawChildren', this._drawChildren);
        this.timer = setTimeout(this._redrawTree, 1000);

    },

    _resetTimer: function() {
        clearTimeout(gApp.timer);
        gApp.timer = setTimeout(gApp._redrawTree, 1000);
    },

    _drawChildren: function() {
        d3.select("#tree").remove();
        g = d3.select('svg').append('g')
            .attr('id','tree')
            .attr("transform","translate(" + gApp.LEFT_MARGIN_SIZE + ",10)");
        gApp._refreshTree();
    },
    
    _redrawTree: function() {
        if (gApp.down('#loadingBox')) gApp.down('#loadingBox').destroy();
        clearTimeout(gApp.timer);
        if (gApp._nodeTree) {
            _.each(gApp._nodeTree.descendants(),
                function(d) { 
//                    if (d.data.record.data._type === "portfolioitem/feature") { debugger;}
                    if (d.card) 
                        d.card.destroy();
                }
            );
            d3.select("#tree").remove();
            gApp._nodeTree = null;
        }
        gApp._enterMainApp();
    },

    _enterMainApp: function() {

        //Timer can fire before we retrieve anything
        if (!gApp._nodes.length) return;

        //Get all the nodes and the "Unknown" parent virtual nodes
        var nodetree = gApp._createTree(gApp._nodes);

        gApp._nodeTree = nodetree;

        gApp._layoutTree(nodetree);
        var viewBoxSize = [  (nodetree.leaves().length * gApp.MIN_ROW_WIDTH) + gApp.LEFT_MARGIN_SIZE, (gApp._highestOrdinal() +1) * gApp.MIN_ROW_HEIGHT];
        gApp._setViewBox(viewBoxSize);

        g = d3.select('svg').append('g')
            .attr('id','tree')
            .attr("transform","translate(" + gApp.LEFT_MARGIN_SIZE + ",10)");

        gApp._refreshTree();    //Need to redraw if things are added
    },

    _layoutTree: function(nodetree) {
        //Add the first node at top right
        nodetree.x = 0;
        nodetree.y = 0;
        nodetree.width = 0;
        gApp._setNodeXY(nodetree);
    },

    //Recursively scan down the tree setting the coordinates for the main tree
    _setNodeXY: function(nodetree) {
        _.each(nodetree.children, function(node, idx){
            node.y =  node.depth * gApp.MIN_ROW_HEIGHT;
            node.x = node.parent.x + node.parent.width;
            node.width = 0;
            node.parent.width += node.leaves()? (node.leaves().length * gApp.MIN_ROW_WIDTH) : gApp.MIN_ROW_WIDTH;
           if (node.children) gApp._setNodeXY(node);
        });
    
    },

    //Entry point after creation of render box
    _onElementValid: function(rs) {

        //Add any useful selectors into this container ( which is inserted before the rootSurface )
        //Choose a point when all are 'ready' to jump off into the rest of the app
        var hdrBox = this.insert (0,{
            xtype: 'container',
            itemId: 'headerBox',
            layout: 'hbox',
            items: [
                {
                    xtype: 'container',
                    itemId: 'filterBox'
                },
                {
                    xtype:  'rallyportfolioitemtypecombobox',
                    itemId: 'piType',
                    fieldLabel: 'Choose Portfolio Type :',
                    labelWidth: 100,
                    margin: '5 0 5 20',
                    defaultSelectionPosition: 'first',
                    listeners: {
                        select: function() { gApp._kickOff();},    //Jump off here to add portfolio size selector
                    }
                },
            ]
        });
    },

    _nodes: [],

    _kickOff: function() {
        var ptype = gApp.down('#piType');
        var hdrBox = gApp.down('#headerBox');
        gApp._typeStore = ptype.store;
        var selector = gApp.down('#itemSelector');
        if ( selector) {
            selector.destroy();
        }
        hdrBox.insert(2,{
            xtype: 'rallyartifactsearchcombobox',
            fieldLabel: 'Choose Start Item :',
            itemId: 'itemSelector',
            labelWidth: 100,
            queryMode: 'remote',
            pageSize: 25,
            width: 600,
            margin: '10 0 5 20',
            storeConfig: {
                models: [ 'portfolioitem/' + ptype.rawValue ],
                fetch: gApp.STORE_FETCH_FIELD_LIST,
                context: gApp.getContext().getDataContext()
            },
            listeners: {
                select: function(selector,store) {
                    gApp.add( {
                        xtype: 'container',
                        itemId: 'loadingBox',
                        cls: 'info--box',
                        html: '<p> Loading... </p>'
                    });
                    if ( gApp._nodes) gApp._nodes = [];
                    gApp._getArtifacts(store);
                }
            }
        });
    },

    _getArtifacts: function(data) {
        //On re-entry send an event to redraw

        gApp._nodes = gApp._nodes.concat( gApp._createNodes(data));    //Add what we started with to the node list

        this.fireEvent('redrawTree');
        //Starting with highest selected by the combobox, go down

        _.each(data, function(parent) {
            //Limit this to portfolio items down to just above feature level and not beyond.
            //The lowest level portfolio item type has 'UserStories' not 'Children'
            if (parent.hasField('Children') && (!parent.data._ref.includes('hierarchicalrequirement'))){      
                collectionConfig = {
                    sorters: [{
                        property: 'DragAndDropRank',
                        direction: 'ASC'
                    }],

                    fetch: gApp.STORE_FETCH_FIELD_LIST,
                    callback: function(records, operation, success) {
                        //Start the recursive trawl down through the levels
                        if (records.length)  gApp._getArtifacts(records);
                    }
                };
                if (gApp.getSetting('hideArchived')) {
                    collectionConfig.filters = [{
                        property: 'Archived',
                        operator: '=',
                        value: false
                    }];
                }
                //debugger;
                parent.getCollection( 'Children').load( collectionConfig );
            }
            else {
                //We are features or UserStories when we come here
                collectionConfig = {
                    sorters: [{
                        property: 'DragAndDropRank',
                        direction: 'ASC'  
                    }],
                    fetch: gApp.STORE_FETCH_FIELD_LIST,
                    callback: function(records, operation, s) {
                        if (s) {
                            if (records && records.length) {

                                //At this point, we need to decide whether we are adding nodes to the main tree
                                //so that it renders across the page....
                                if (gApp.getSetting('includeStories')){
                                    gApp._nodes = gApp._nodes.concat( gApp._createNodes(records));
                                    gApp.fireEvent('redrawTree');
                                } 
                                // ...or that we are at the bottom and now need to do a vertical line of things
                                else {
                                    gApp._addChildren(parent,records);
                                }
                            }
                        }
                    }
                };
                //If we are lowest level PI, then we need to fetch User Stories
                if (parent.hasField('UserStories')) {  
                    collectionConfig.fetch.push(gApp._getModelFromOrd(0).split("/").pop()); //Add the lowest level field on User Stories
                    parent.getCollection( 'UserStories').load( collectionConfig );
                } 
                //If we are userstories, then we need to fetch tasks
                else if (parent.hasField('Tasks') && (gApp.getSetting('includeStories'))){
                    parent.getCollection( 'Tasks').load( collectionConfig );                    
                }
            }
        });
    },

    //Set the SVG area to the surface we have provided
    _setSVGSize: function(surface) {
        var svg = d3.select('svg');
        svg.attr('width', surface.getEl().dom.clientWidth);
        svg.attr('height',surface.getEl().dom.clientHeight);
    },
    _nodeTree: null,
    //Continuation point after selectors ready/changed

    _setViewBox: function(viewBoxSize) {
       var svg = d3.select('svg');
        var rs = this.down('#rootSurface');
        rs.getEl().setWidth(viewBoxSize[0]);
        rs.getEl().setHeight(viewBoxSize[1]);
        //Set the svg area to the surface
       this._setSVGSize(rs);
        svg.attr('class', 'rootSurface');
        svg.attr('preserveAspectRatio', 'none');
        svg.attr('viewBox', '0 0 ' + viewBoxSize[0] + ' ' + viewBoxSize[1]);
    },

    _refreshTree: function(){
        var g = d3.select('#tree');
        var nodetree = gApp._nodeTree;
         g.selectAll(".link")
            .data(nodetree.descendants().slice(1))
            .enter().append("path")
            .attr("class", function(d) { return d.data.invisibleLink? "invisible--link" :  "local--link" ;})
            .attr("d", function(d) {
                    return "M" + (d.x+(gApp.MIN_CARD_WIDTH/2)) + "," + d.y
                        + "S" + (d.x + gApp.MIN_CARD_WIDTH) + "," + d.parent.y
//                        + " " + (d.parent.x + 100) + "," + d.parent.y
                        + " " + (d.parent.x+(gApp.MIN_CARD_WIDTH/2)) + "," + (d.parent.y+3);
            })
            ;
        var node = g.selectAll(".node")
            .data(nodetree.descendants())
            .enter().append("g")
            .attr("id", function(d) { return 'group' + d.data.record.data.FormattedID;})
            .attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });

        node.each( function(d) {
            if ( d.data.children && gApp._plotChildren(d)){
                    //We need to find down to the level
                    var deepestNode = _.max(gApp._nodeTree.descendants(), function(item) { 
                        return item.depth + (item.data.children?item.data.children.length:0);}
                    );
                    //Now add the child tail length (which is drawn down the page)
                    var childDepth = (deepestNode.data.children ? (deepestNode.data.children.length + deepestNode.depth + 1) * gApp.MIN_ROW_HEIGHT : 0);
                    //Set the visible page to this size
                    var svgSize = d3.select('svg').attr('viewBox').split(" ");
                    gApp._setViewBox([ parseInt(svgSize[2]), (parseInt(svgSize[3])> childDepth) ? parseInt(svgSize[3]): childDepth]);
                }
        });

        gApp._drawNodes(node);

    },

    _findParentTreeNode: function(nodetree, item) {
        return _.find(nodetree.descendants(), function(d) { 
            return d.id === item.data._ref;
        });
    },
    // Now that we have the tree plotted to the end, we can find all the leaves and add all the children in a vertical line underneath
    _addChildren: function(parent, items) {

        _.each(items, function(item) {
            var leaf = gApp._createTree(gApp._createNodes([item]));    //Try to create a node from the 'single' datum       
            var parentNode = gApp._findParentNode(gApp._nodes,leaf.data); //Try and find the node in the current tree
            if (parentNode) {
                parentNode.children? parentNode.children.push(leaf): parentNode.children = [leaf];
    //            parentNode.appendChild(leaf);   //Attempt to link it to the parent
            }
        });
    },

    _plotChildren: function (parent) {
        var addedChildren = 0;
        _.each(parent.data.children, function(node, idx){
            node.parent = parent;
            node.x = parent.x;
            node.y = parent.y + ((idx+1) * gApp.MIN_ROW_HEIGHT);
            node.depth = parent.depth + 1;
            node.height = 0;
            addedChildren +=1 ;
        });
        if (addedChildren !== 0) {
            // gApp.fireEvent('redrawTree');
            return true;
        }
        return false;
    },

    _drawNodes: function(node) {
        gApp._drawNode(node);

        node.each( function (d, index, array) {
            if ( d.data.children) {
                var childnode = g.selectAll(".node")
                    .data(d.data.children)
                    .enter().append("g")
                    .attr("id", function(d) { return 'group' + d.data.record.data.FormattedID;})
                    .attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });
                gApp._drawNode(childnode);
            }
        });
    },

    _drawNode: function(node) {
        node.append("rect")
            .attr("dy", -3)
            .attr("rx", gApp.NODE_CIRCLE_SIZE)
            .attr("ry", gApp.NODE_CIRCLE_SIZE)
            .attr("width", gApp.MIN_CARD_WIDTH)
            .attr("height", gApp.MIN_CARD_HEIGHT)
            .attr("class", function (d) {   //Work out the individual dot colour
                var lClass = "dotOutline"; // Might want to use outline to indicate something later
                if (d.data.record.data.ObjectID){
                    if (d.data.record.isTask()) return d.data.record.get('Blocked')? "blockedOutline": d.data.record.get('Ready')?"readyOutline":"";
                    else if (d.data.record.isUserStory()) return d.data.record.get('Blocked')? "blockedOutline": d.data.record.get('Ready')?"readyOutline":"";
                    else return (d.data.record.get('Ready')?"readyOutline":"");      //Not been set - which is an error in itself
                } else {
                    return d.data.error ? "error--node": "no--errors--done";
                }
            })
            .on("click", function(node, index, array) { gApp._nodeClick(node,index,array);})
            .on("mouseover", function(node, index, array) { gApp._nodeMouseOver(node,index,array);})
            .on("mouseout", function(node, index, array) { gApp._nodeMouseOut(node,index,array);})
            .attr("fill", function(d) {
                //Get existing colour to use if we don't set anything
                //Check if we are a userstory and set color to stored DisplayColor, if unset, don't modify the class setting
                if (d.data.record.isUserStory()) {
                    return d.data.record.get('DisplayColor')?d.data.record.get('DisplayColor'): '#c0c0c0';
                } else if (d.data.record.isTask()) {
                    return d.data.record.get('DisplayColor')?d.data.record.get('DisplayColor'): '#cfcf0f';
                }
                else return d.data.record.get('DisplayColor')?d.data.record.get('DisplayColor'): '#21ae7f';
            });

        //We need to work out how much text we can see
        var ssLength = 25;
        var ssHeight = 14;  //Match CSS height of default text.
        node.each(
            function(d, index, array) {
                var g = d3.select(array[index]);
                g.append("text")
                    .text( function(d) { 
                        var retval= d.data.record && d.data.record.get('FormattedID');
//                        if (retval == "US89405") debugger;
                        return retval;
                     })
                    .attr("class", "info--box")
                    .attr("dx", gApp.MIN_CARD_WIDTH/2)
                    .attr("dy", 18)    //Matches CSS file
                    .attr("text-anchor","middle");
                var title = d.data.record && d.data.record.get('Name').substring(0,gApp.TITLE_NAME_LENGTH);
                for ( var i = 0, l = 2; i < title.length;  l +=1){
                    var t = gApp._splitClosestSpace(title.substr(i), ssLength);
                    g.append("text").text(t)
                        .attr("dx", gApp.NODE_CIRCLE_SIZE)
                        .attr("dy",gApp.NODE_CIRCLE_SIZE+(l * ssHeight));
                    i += t.length;
                }
                //Now draw last set of items down page
//                
        })
        //Fix issue of small area to hover over due to z-layer
        .on("mouseover", function(node, index, array) { gApp._nodeMouseOver(node,index,array);})
        .on("mouseout", function(node, index, array) { gApp._nodeMouseOut(node,index,array);});
    },

    _splitClosestSpace: function(text, length) {
        if (text.length < length) return text;
        var lastSpace = _.lastIndexOf(text.substr(0, length)," ");
        if (lastSpace>0) return text.substring(0,lastSpace);
        else return text.substr(0, length);
    
    },
    
    _nodeMouseOut: function(node, index,array){
        if (node.card) node.card.hide();
    },

    _nodeMouseOver: function(node,index,array) {
        if (!(node.data.record.data.ObjectID)) {
            //Only exists on real items, so do something for the 'unknown' item
            return;
        } else {

            if ( !node.card) {
                var card = Ext.create('Rally.ui.cardboard.Card', {
                    'record': node.data.record,
                    fields: gApp.CARD_DISPLAY_FIELD_LIST,
                    constrain: false,
                    width: gApp.MIN_COLUMN_WIDTH,
                    height: 'auto',
                    floating: true, //Allows us to control via the 'show' event
                    shadow: false,
                    showAge: true,
                    resizable: true,
                    listeners: {
                        show: function(card){
                            //Move card to one side, preferably closer to the centre of the screen
                            var xpos = array[index].getScreenCTM().e - gApp.MIN_COLUMN_WIDTH;
                            var ypos = array[index].getScreenCTM().f;
                            card.el.setLeftTop( (xpos - gApp.MIN_CARD_WIDTH) < 0 ? xpos + gApp.MIN_CARD_WIDTH + gApp.MIN_COLUMN_WIDTH : xpos - gApp.MIN_CARD_WIDTH, 
                                (ypos + this.getSize().height)> gApp.getSize().height ? gApp.getSize().height - (this.getSize().height+20) : ypos);  //Tree is rotated
                        }
                    }
                });
                node.card = card;
            }
            node.card.show();
        }
    },

    _nodeClick: function (node,index,array) {
        if (!(node.data.record.data.ObjectID)) return; //Only exists on real items
        //Get ordinal (or something ) to indicate we are the lowest level, then use "UserStories" instead of "Children"

        var childField = null;
        var model = null;

        //Userstories have children, Portfolio Items have children... doh!
         if (node.data.record.hasField('Tasks')) {
            childField = 'Tasks';
            model = 'UserStory';
        }         
        else if (node.data.record.hasField('Children')) {
            childField = 'Children';
            model = node.data.record.data.Children._type;
        }
        else if (node.data.record.hasField('UserStories')){
            childField = 'UserStories';
            model = node.data.record.data._type;
        }
        else return;    //Don't do this for tasks.

        Ext.create('Rally.ui.dialog.Dialog', {
            autoShow: true,
            draggable: true,
            closable: true,
            width: 1100,
            height: 800,
            style: {
                border: "thick solid #000000"
            },
            overflowY: 'scroll',
            overflowX: 'none',
            record: node.data.record,
            disableScroll: false,
            model: model,
            childField: childField,
            title: 'Information for ' + node.data.record.get('FormattedID') + ': ' + node.data.record.get('Name'),
            layout: 'hbox',
            items: [
                {
                    xtype: 'container',
                    itemId: 'leftCol',
                    width: 500,
                },
                // {
                //     xtype: 'container',
                //     itemId: 'middleCol',
                //     width: 400
                // },
                {
                    xtype: 'container',
                    itemId: 'rightCol',
                    width: 580  //Leave 20 for scroll bar
                }
            ],
            listeners: {
                afterrender: function() {
                    this.down('#leftCol').add(
                        {
                                xtype: 'rallycard',
                                record: this.record,
                                fields: gApp.CARD_DISPLAY_FIELD_LIST,
                                showAge: true,
                                resizable: true
                        }
                    );

                    if ( this.record.get('c_ProgressUpdate')){
                        this.down('#leftCol').insert(1,
                            {
                                xtype: 'component',
                                width: '100%',
                                autoScroll: true,
                                html: this.record.get('c_ProgressUpdate')
                            }
                        );
                        this.down('#leftCol').insert(1,
                            {
                                xtype: 'text',
                                text: 'Progress Update: ',
                                style: {
                                    fontSize: '13px',
                                    textTransform: 'uppercase',
                                    fontFamily: 'ProximaNova,Helvetica,Arial',
                                    fontWeight: 'bold'
                                },
                                margin: '0 0 10 0'
                            }
                        );
                    }
                    //This is specific to customer. Features are used as RAIDs as well.
                    if ((this.record.self.ordinal === 1) && this.record.hasField('c_RAIDType')){
                        var rai = this.down('#leftCol').add(
                            {
                                xtype: 'rallypopoverchilditemslistview',
                                target: array[index],
                                record: this.record,
                                childField: this.childField,
                                addNewConfig: null,
                                gridConfig: {
                                    title: '<b>Risks and Issues:</b>',
                                    enableEditing: false,
                                    enableRanking: false,
                                    enableBulkEdit: false,
                                    showRowActionsColumn: false,
                                    storeConfig: this.RAIDStoreConfig(),
                                    columnCfgs : [
                                        'FormattedID',
                                        'Name',
                                        'c_RAIDType',
                                        'State',
                                        'c_RAGStatus',
                                        'ScheduleState'
                                    ]
                                },
                                model: this.model
                            }
                        );
                        rai.down('#header').destroy();
                   }

                    var children = this.down('#leftCol').add(
                        {
                            xtype: 'rallypopoverchilditemslistview',
                            target: array[index],
                            record: this.record,
                            childField: this.childField,
                            addNewConfig: null,
                            gridConfig: {
                                title: '<b>Children:</b>',
                                enableEditing: false,
                                enableRanking: false,
                                enableBulkEdit: false,
                                showRowActionsColumn: false,
                                storeConfig: this.nonRAIDStoreConfig(),
                                columnCfgs : [
                                    'FormattedID',
                                    'Name',
                                    {
                                        text: '% By Count',
                                        dataIndex: 'PercentDoneByStoryCount'
                                    },
                                    {
                                        text: '% By Est',
                                        dataIndex: 'PercentDoneByStoryPlanEstimate'
                                    },
                                    'State',
                                    'c_RAGSatus',
                                    'ScheduleState'
                                ]
                            },
                            model: this.model
                        }
                    );
                    children.down('#header').destroy();

                    var cfd = Ext.create('Rally.apps.CFDChart', {
                        record: this.record,
                        container: this.down('#rightCol')
                    });
                    cfd.generateChart();

                    //Now add predecessors and successors
                    var preds = this.down('#rightCol').add(
                        {
                            xtype: 'rallypopoverchilditemslistview',
                            target: array[index],
                            record: this.record,
                            childField: 'Predecessors',
                            addNewConfig: null,
                            gridConfig: {
                                title: '<b>Predecessors:</b>',
                                enableEditing: false,
                                enableRanking: false,
                                enableBulkEdit: false,
                                showRowActionsColumn: false,
                                columnCfgs : [
                                'FormattedID',
                                'Name',
                                {
                                    text: '% By Count',
                                    dataIndex: 'PercentDoneByStoryCount'
                                },
                                {
                                    text: '% By Est',
                                    dataIndex: 'PercentDoneByStoryPlanEstimate'
                                },
                                'State',
                                'c_RAGSatus',
                                'ScheduleState'
                                ]
                            },
                            model: this.model
                        }
                    );
                    preds.down('#header').destroy();
                    var succs = this.down('#rightCol').add(
                        {
                            xtype: 'rallypopoverchilditemslistview',
                            target: array[index],
                            record: this.record,
                            childField: 'Successors',
                            addNewConfig: null,
                            gridConfig: {
                                title: '<b>Successors:</b>',
                                enableEditing: false,
                                enableRanking: false,
                                enableBulkEdit: false,
                                showRowActionsColumn: false,
                                columnCfgs : [
                                'FormattedID',
                                'Name',
                                {
                                    text: '% By Count',
                                    dataIndex: 'PercentDoneByStoryCount'
                                },
                                {
                                    text: '% By Est',
                                    dataIndex: 'PercentDoneByStoryPlanEstimate'
                                },
                                'State',
                                'c_RAGSatus',
                                'ScheduleState'
                                ]
                            },
                            model: this.model
                        }
                    );
                    succs.down('#header').destroy();
                }
            },

            //This is specific to customer. Features are used as RAIDs as well.
            nonRAIDStoreConfig: function() {
                if (this.record.hasField('c_RAIDType') ){
                    switch (this.record.self.ordinal) {
                        case 1:
                            return  {
                                filters: {
                                    property: 'c_RAIDType',
                                    operator: '=',
                                    value: ''
                                }
                            };
                        default:
                            return {};
                    }
                }
                else return {};
            },

            //This is specific to customer. Features are used as RAIDs as well.
            RAIDStoreConfig: function() {
                var retval = {};

                if (this.record.hasField('c_RAIDType') && this.record.hasField('c_RAGStatus')){
                            return {
                                filters: [{
                                    property: 'c_RAIDType',
                                    operator: '!=',
                                    value: ''
                                },
                                {
                                    property: 'c_RAGStatus',
                                    operator: '=',
                                    value: 'RED'
                                }]
                            };
                    }
                    else return {};
                }
            });
    },

    _dataCheckForItem: function(d){
        return "";
    },

    _createNodes: function(data) {
        //These need to be sorted into a hierarchy based on what we have. We are going to add 'other' nodes later
        var nodes = [];
        //Push them into an array we can reconfigure
        _.each(data, function(record) {
            var localNode = (gApp.getContext().getProjectRef() === record.get('Project')._ref);
            nodes.push({'Name': record.get('FormattedID'), 'record': record, 'local': localNode, 'dependencies': []});
        });
        return nodes;
    },

    // _findNode: function(nodes, record) {
    //     var returnNode = null;
    //         _.each(nodes, function(node) {
    //             if ((node.record && node.record.data._ref) === record._ref){
    //                  returnNode = node;
    //             }
    //         });
    //     return returnNode;

    // },
    _findParentType: function(record) {
        //The only source of truth for the hierachy of types is the typeStore using 'Ordinal'
        var ord = null;
        for ( var i = 0;  i < gApp._typeStore.totalCount; i++ )
        {
            if (record.data._type === gApp._typeStore.data.items[i].get('TypePath').toLowerCase()) {
                ord = gApp._typeStore.data.items[i].get('Ordinal');
                break;
            }
        }
        ord += 1;   //We want the next one up, if beyond the list, set type to root
        //If we fail this, then this code is wrong!
        if ( i >= gApp._typeStore.totalCount) {
            return null;
        }
        var typeRecord =  _.find(  gApp._typeStore.data.items, function(type) { return type.get('Ordinal') === ord;});
        return (typeRecord && typeRecord.get('TypePath').toLowerCase());
    },
    _findNodeById: function(nodes, id) {
        return _.find(nodes, function(node) {
            return node.record.data._ref === id;
        });
    },
        //Routines to manipulate the types

    _getSelectedOrdinal: function() {
        return gApp.down('#piType').lastSelection[0].get('Ordinal');
    },

     _getTypeList: function(highestOrdinal) {
        var piModels = [];
        _.each(gApp._typeStore.data.items, function(type) {
            //Only push types below that selected
            if (type.data.Ordinal <= (highestOrdinal ? highestOrdinal: 0) )
                piModels.push({ 'type': type.data.TypePath.toLowerCase(), 'Name': type.data.Name, 'ref': type.data._ref});
        });
        return piModels;
    },

    _highestOrdinal: function() {
        return _.max(gApp._typeStore.data.items, function(type) { return type.get('Ordinal'); }).get('Ordinal');
    },
    _getModelFromOrd: function(number){
        var model = null;
        _.each(gApp._typeStore.data.items, function(type) { if (number == type.get('Ordinal')) { model = type; } });
        return model && model.get('TypePath');
    },

    _getOrdFromModel: function(modelName){
        var model = null;
        _.each(gApp._typeStore.data.items, function(type) {
            if (modelName == type.get('TypePath').toLowerCase()) {
                model = type.get('Ordinal');
            }
        });
        return model;
    },

    _findParentNode: function(nodes, child){
        var record = child.record;
        if (record.data._ref === 'root') return null;

        //Nicely inconsistent in that the 'field' representing a parent of a user story has the name the same as the type
        // of the first level of the type hierarchy.
        var parentField = gApp._getModelFromOrd(0).split("/").pop();
        var parent = record.hasField('WorkProduct')? record.data.WorkProduct : record.hasField('Tasks')?record.data[parentField]:record.data.Parent;
        var pParent = null;
        if (parent ){
            //Check if parent already in the node list. If so, make this one a child of that one
            //Will return a parent, or null if not found
            pParent = gApp._findNodeById(nodes, parent._ref);
        }
        else {
            //Here, there is no parent set, so attach to the 'null' parent.
            var pt = gApp._findParentType(record);
            //If we are at the top, we will allow d3 to make a root node by returning null
            //If we have a parent type, we will try to return the null parent for this type.
            if (pt) {
                var parentName = '/' + pt + '/null';
                pParent = gApp._findNodeById(nodes, parentName);
            }
        }
        //If the record is a type at the top level, then we must return something to indicate 'root'
        return pParent?pParent: gApp._findNodeById(nodes, 'root');
    },

    _createTree: function (nodes) {
        //Try to use d3.stratify to create nodet
        var nodetree = d3.stratify()
                    .id( function(d) {
                        var retval = (d.record && d.record.data._ref) || null; //No record is an error in the code, try to barf somewhere if that is the case
                        return retval;
                    })
                    .parentId( function(d) {
                        var pParent = gApp._findParentNode(nodes, d);
                        return (pParent && pParent.record && pParent.record.data._ref); })
                    (nodes);
        return nodetree;
    },

    initComponent: function() {
        this.callParent(arguments);
        this.addEvents('redrawTree');
    }
});
}());